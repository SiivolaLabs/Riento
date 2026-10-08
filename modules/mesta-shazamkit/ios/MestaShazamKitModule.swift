import AVFoundation
import ExpoModulesCore
import ShazamKit

public class MestaShazamKitModule: Module {
  private var matcher: OneShotShazamKitMatcher?

  public func definition() -> ModuleDefinition {
    Name("MestaShazamKit")

    AsyncFunction("recognizeOneShotAsync") { (options: [String: String], promise: Promise) in
      guard self.matcher == nil else {
        promise.resolve(MestaShazamKitResult.providerUnavailable("A venue music check is already running."))
        return
      }

      let matcher = OneShotShazamKitMatcher(venueName: options["venueName"], timeoutSeconds: 12) { [weak self, promise] result in
        self?.matcher = nil
        promise.resolve(result)
      }

      self.matcher = matcher
      matcher.start()
    }
    .runOnQueue(.main)

    AsyncFunction("cancelRecognitionAsync") { (promise: Promise) in
      guard let matcher = self.matcher else {
        promise.resolve(["ok": false, "message": "No foreground music check is running."])
        return
      }

      matcher.cancel(message: "Music check cancelled before a match was found.")
      promise.resolve(["ok": true, "message": "Stopping the foreground music check..."])
    }
    .runOnQueue(.main)

    OnAppEntersBackground {
      self.matcher?.cancel(message: "Music check stopped because Mesta moved to the background.")
    }

    OnDestroy {
      self.matcher?.cancel(message: "Music check stopped because the native module was destroyed.")
    }
  }
}

private enum MestaShazamKitResult {
  static func matched(title: String, artistName: String?, venueName: String?) -> [String: Any] {
    var match: [String: Any] = ["title": title]

    if let artistName, !artistName.isEmpty {
      match["artistName"] = artistName
    }

    return [
      "ok": true,
      "provider": "shazamkit",
      "status": "matched",
      "match": match,
      "message": "Matched \(formatTrack(title: title, artistName: artistName))\(venueText(venueName)). This iPhone match stays on this device until you send private accuracy feedback."
    ]
  }

  static func noMatch(_ message: String) -> [String: Any] {
    return [
      "ok": false,
      "provider": "shazamkit",
      "status": "no_match",
      "message": message
    ]
  }

  static func providerUnavailable(_ message: String) -> [String: Any] {
    return [
      "ok": false,
      "provider": "shazamkit",
      "status": "provider_unavailable",
      "message": message
    ]
  }

  static func venueText(_ venueName: String?) -> String {
    guard let venueName, !venueName.isEmpty else {
      return ""
    }

    return " at \(venueName)"
  }

  private static func formatTrack(title: String, artistName: String?) -> String {
    guard let artistName, !artistName.isEmpty else {
      return title
    }

    return "\(title) - \(artistName)"
  }
}

private final class OneShotShazamKitMatcher: NSObject, SHSessionDelegate {
  private let audioEngine = AVAudioEngine()
  private let completion: ([String: Any]) -> Void
  private let session = SHSession()
  private let timeoutSeconds: TimeInterval
  private let venueName: String?
  private var didFinish = false
  private var didInstallTap = false
  private var timeoutWorkItem: DispatchWorkItem?

  init(venueName: String?, timeoutSeconds: TimeInterval, completion: @escaping ([String: Any]) -> Void) {
    self.completion = completion
    self.timeoutSeconds = timeoutSeconds
    self.venueName = venueName
    super.init()
    session.delegate = self
  }

  func start() {
    do {
      try configureAudioSession()
      addAudioSessionObservers()

      let inputNode = audioEngine.inputNode
      let inputFormat = inputNode.outputFormat(forBus: 0)

      guard inputFormat.channelCount > 0 else {
        finish(MestaShazamKitResult.providerUnavailable("No microphone input was available for the venue music check."))
        return
      }

      inputNode.installTap(onBus: 0, bufferSize: 4_096, format: inputFormat) { [weak self] buffer, audioTime in
        self?.session.matchStreamingBuffer(buffer, at: audioTime)
      }
      didInstallTap = true

      audioEngine.prepare()
      try audioEngine.start()
      scheduleTimeout()
    } catch {
      finish(MestaShazamKitResult.providerUnavailable("Could not start ShazamKit matching: \(error.localizedDescription). No audio was stored or uploaded."))
    }
  }

  func cancel(message: String) {
    finish(MestaShazamKitResult.noMatch("\(message) No audio was stored or uploaded."))
  }

  func session(_ session: SHSession, didFind match: SHMatch) {
    guard let mediaItem = match.mediaItems.first, let title = mediaItem.title, !title.isEmpty else {
      finish(MestaShazamKitResult.providerUnavailable("ShazamKit returned an incomplete match. No now-playing report was sent."))
      return
    }

    finish(MestaShazamKitResult.matched(title: title, artistName: mediaItem.artist, venueName: venueName))
  }

  func session(_ session: SHSession, didNotFindMatchFor signature: SHSignature, error: Error?) {
    if let error {
      finish(MestaShazamKitResult.providerUnavailable("ShazamKit could not complete matching: \(error.localizedDescription). No audio was stored or uploaded."))
      return
    }

      finish(MestaShazamKitResult.noMatch("No ShazamKit match was found\(MestaShazamKitResult.venueText(venueName)). No new now-playing signal was sent."))
  }

  private func configureAudioSession() throws {
    let audioSession = AVAudioSession.sharedInstance()

    guard audioSession.recordPermission == .granted else {
      throw MestaShazamKitError.microphonePermissionMissing
    }

    try audioSession.setCategory(.record, mode: .measurement)
    try audioSession.setActive(true)
  }

  private func scheduleTimeout() {
    let timeoutWorkItem = DispatchWorkItem { [weak self] in
      guard let self else {
        return
      }

      self.finish(MestaShazamKitResult.noMatch("No ShazamKit match was found after a short foreground check\(MestaShazamKitResult.venueText(self.venueName)). No audio was stored or uploaded."))
    }

    self.timeoutWorkItem = timeoutWorkItem
    DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: timeoutWorkItem)
  }

  private func addAudioSessionObservers() {
    NotificationCenter.default.addObserver(self, selector: #selector(handleAudioInterruption), name: AVAudioSession.interruptionNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(handleAudioRouteChange), name: AVAudioSession.routeChangeNotification, object: nil)
  }

  @objc private func handleAudioInterruption(_ notification: Notification) {
    guard let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: rawType),
      type == .began else {
      return
    }

    cancel(message: "Music check stopped because audio input was interrupted.")
  }

  @objc private func handleAudioRouteChange(_ notification: Notification) {
    guard let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason),
      reason == .oldDeviceUnavailable else {
      return
    }

    cancel(message: "Music check stopped because the microphone route changed.")
  }

  private func finish(_ result: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      guard let self, !self.didFinish else {
        return
      }

      self.didFinish = true
      self.timeoutWorkItem?.cancel()
      self.timeoutWorkItem = nil
      self.stopAudio()
      self.completion(result)
    }
  }

  private func stopAudio() {
    NotificationCenter.default.removeObserver(self)

    if didInstallTap {
      audioEngine.inputNode.removeTap(onBus: 0)
      didInstallTap = false
    }

    if audioEngine.isRunning {
      audioEngine.stop()
    }

    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }
}

private enum MestaShazamKitError: LocalizedError {
  case microphonePermissionMissing

  var errorDescription: String? {
    switch self {
    case .microphonePermissionMissing:
      return "Microphone permission has not been granted"
    }
  }
}
