package expo.modules.mestaacrcloud

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

class MestaAcrCloudModule : Module() {
  private val cancelRequested = AtomicBoolean(false)
  private val isRunning = AtomicBoolean(false)

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  override fun definition() = ModuleDefinition {
    Name("MestaAcrCloud")

    AsyncFunction("recognizeOneShotAsync") Coroutine { options: Map<String, Any?> ->
      if (!isRunning.compareAndSet(false, true)) {
        return@Coroutine providerUnavailable("A venue music check is already running.")
      }

      cancelRequested.set(false)

      try {
        val timeoutMs = (options["timeoutMs"] as? Number)?.toLong() ?: 12_000L
        val venueName = options["venueName"] as? String

        return@Coroutine withContext(Dispatchers.IO) {
          captureAndFingerprint(timeoutMs.coerceIn(4_000L, 15_000L), venueName)
        }
      } finally {
        isRunning.set(false)
        cancelRequested.set(false)
      }
    }

    AsyncFunction("cancelRecognitionAsync") {
      val wasRunning = isRunning.get()
      cancelRequested.set(true)

      mapOf(
        "ok" to wasRunning,
        "message" to if (wasRunning) "Stopping the Android foreground music check..." else "No Android foreground music check is running."
      )
    }

    OnActivityEntersBackground {
      cancelRequested.set(true)
    }

    OnDestroy {
      cancelRequested.set(true)
    }
  }

  private fun captureAndFingerprint(timeoutMs: Long, venueName: String?): Map<String, Any> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      return providerUnavailable("Microphone permission is missing for the Android music check.")
    }

    val sampleRate = 8_000
    val channelConfig = AudioFormat.CHANNEL_IN_MONO
    val audioFormat = AudioFormat.ENCODING_PCM_16BIT
    val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)

    if (minBufferSize <= 0) {
      return providerUnavailable("Android microphone input was not available for fingerprinting.")
    }

    val recorder = AudioRecord(
      MediaRecorder.AudioSource.MIC,
      sampleRate,
      channelConfig,
      audioFormat,
      minBufferSize * 2
    )

    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      return providerUnavailable("Android microphone input could not be initialized for fingerprinting.")
    }

    val pcmOutput = ByteArrayOutputStream()
    val buffer = ByteArray(minBufferSize)
    val deadline = SystemClock.elapsedRealtime() + timeoutMs

    try {
      recorder.startRecording()

      while (!cancelRequested.get() && SystemClock.elapsedRealtime() < deadline) {
        val read = recorder.read(buffer, 0, buffer.size)

        if (read > 0) {
          pcmOutput.write(buffer, 0, read)
        }
      }
    } catch (error: SecurityException) {
      return providerUnavailable("Microphone permission is missing for the Android music check.")
    } finally {
      if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
        recorder.stop()
      }

      recorder.release()
    }

    if (cancelRequested.get()) {
      return noMatch("Music check cancelled before a fingerprint was sent. No raw audio was stored.")
    }

    val pcmBytes = pcmOutput.toByteArray()
    val sampleMs = (pcmBytes.size / 2.0 / sampleRate * 1_000).toInt()

    if (sampleMs < 3_000) {
      return noMatch("The Android music check was too short to fingerprint. No raw audio was stored.")
    }

    val wavBytes = buildPcm16Wav(pcmBytes, sampleRate, 1)
    val fingerprintBytes = createAcrCloudFingerprint(wavBytes, sampleRate, 1)

    if (fingerprintBytes == null || fingerprintBytes.isEmpty()) {
      return providerUnavailable("ACRCloud Android SDK binaries are not bundled or did not create a fingerprint. No raw audio was stored.")
    }

    return mapOf(
      "ok" to true,
      "provider" to "acrcloud",
      "status" to "fingerprinted",
      "fingerprintBase64" to Base64.encodeToString(fingerprintBytes, Base64.NO_WRAP),
      "sampleMs" to sampleMs,
      "message" to "Created a short Android ACRCloud fingerprint${venueText(venueName)}. No raw audio was stored."
    )
  }

  private fun createAcrCloudFingerprint(wavBytes: ByteArray, sampleRate: Int, channelCount: Int): ByteArray? {
    return try {
      val clientClass = Class.forName("com.acrcloud.rec.ACRCloudClient")
      val method = clientClass.getMethod(
        "createClientFingerprint",
        ByteArray::class.java,
        Integer.TYPE,
        Integer.TYPE,
        Integer.TYPE
      )

      method.invoke(null, wavBytes, wavBytes.size, sampleRate, channelCount) as? ByteArray
    } catch (_: Throwable) {
      null
    }
  }

  private fun buildPcm16Wav(pcmBytes: ByteArray, sampleRate: Int, channelCount: Int): ByteArray {
    val byteRate = sampleRate * channelCount * 2
    val totalDataLen = pcmBytes.size + 36
    val output = ByteArrayOutputStream(pcmBytes.size + 44)
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)

    header.put("RIFF".toByteArray(Charsets.US_ASCII))
    header.putInt(totalDataLen)
    header.put("WAVE".toByteArray(Charsets.US_ASCII))
    header.put("fmt ".toByteArray(Charsets.US_ASCII))
    header.putInt(16)
    header.putShort(1.toShort())
    header.putShort(channelCount.toShort())
    header.putInt(sampleRate)
    header.putInt(byteRate)
    header.putShort((channelCount * 2).toShort())
    header.putShort(16.toShort())
    header.put("data".toByteArray(Charsets.US_ASCII))
    header.putInt(pcmBytes.size)

    output.write(header.array())
    output.write(pcmBytes)

    return output.toByteArray()
  }

  private fun providerUnavailable(message: String): Map<String, Any> {
    return mapOf(
      "ok" to false,
      "provider" to "acrcloud",
      "status" to "provider_unavailable",
      "message" to message
    )
  }

  private fun noMatch(message: String): Map<String, Any> {
    return mapOf(
      "ok" to false,
      "provider" to "acrcloud",
      "status" to "no_match",
      "message" to message
    )
  }

  private fun venueText(venueName: String?): String {
    return if (venueName.isNullOrBlank()) "" else " at $venueName"
  }
}
