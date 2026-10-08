import { useRef, useState } from "react";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as AppleAuthentication from "expo-apple-authentication";
import type { User } from "@supabase/supabase-js";
import { Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import { Screen } from "../../src/components/Screen";
import { useAuth } from "../../src/context/AuthContext";
import { useMusicRecognitionSettings } from "../../src/hooks/useMusicRecognitionSettings";
import { useProfileSettings } from "../../src/hooks/useProfileSettings";
import { useSavedVenueSlugs } from "../../src/hooks/useSavedVenueSlugs";
import { venueMetadataAttribution } from "../../src/data/venueMetadata";
import { legalPages, type LegalPageName, openLegalPage } from "../../src/lib/legal";
import { clearReviewAuthorBlocks, deleteDeviceData, getDeviceDataExport, resumePendingDeviceDataDeletion } from "../../src/services/profileService";
import { isSocialAuthCancellation, requestAppleCredential } from "../../src/services/socialAuthService";
import { colors } from "../../src/theme/colors";

const supportEmail = "Siivola.Labs@proton.me";
const supportMailUrl = `mailto:${supportEmail}?subject=Riento%20Support`;

export default function SettingsScreen() {
  const router = useRouter();
  const { accountProviders, authCallbackMessage, completePasswordRecovery, createAccount, finalizeDeviceDataDeletion, isAdmin, isAnonymous, isAuthBusy, isLoading: sessionLoading, isPasswordRecovery, resetUnverifiedIdentity, runExclusiveAuthOperation, sendPasswordReset, sessionError, signIn, signInWithApple, signInWithGoogle, signOut, updateAccountPassword, user, verifyNoUnavailableIdentity } = useAuth();
  const { clearSaved, isLoading: savedLoading, savedVenueSlugs } = useSavedVenueSlugs();
  const { error: settingsError, isLoading: settingsLoading, resetSettings, setGpsOnMapOpen, setManualPlacementEnabled, settings } = useProfileSettings();
  const {
    error: musicSettingsError,
    isLoading: musicSettingsLoading,
    resetSettings: resetMusicSettings,
    setPromptEnabled,
    settings: musicSettings
  } = useMusicRecognitionSettings();
  const [accountEmail, setAccountEmail] = useState("");
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [accountPassword, setAccountPassword] = useState("");
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [isAccountActionRunning, setIsAccountActionRunning] = useState(false);
  const [isDeletingAnonymousSession, setIsDeletingAnonymousSession] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [legalMessage, setLegalMessage] = useState<string | null>(null);
  const currentUserRef = useRef(user);
  currentUserRef.current = user;
  const hasPermanentAccount = Boolean(user && !isAnonymous);
  const hasEmailAccount = accountProviders.includes("email");
  const pendingAccountEmail = user?.email ?? user?.new_email;
  const isAccountOperationRunning = isAccountActionRunning || isAuthBusy || isDeleting || isDeletingAnonymousSession;
  const isAccountBusy = isAccountOperationRunning || Boolean(sessionError);

  async function runAccountAction(action: () => Promise<{ message: string; ok: boolean }>) {
    setIsAccountActionRunning(true);
    setAccountMessage(null);

    try {
      const result = await action();
      setAccountMessage(result.message);

      if (result.ok) {
        setAccountPassword("");
      }
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "The account action could not be completed.");
    } finally {
      setIsAccountActionRunning(false);
    }
  }

  async function handleClearMySpots() {
    await clearSaved();
    setDataMessage("My spots were cleared from this device.");
  }

  async function handleClearReviewBlocks() {
    if (!user) {
      setDataMessage("No private session exists, so there are no stored reviewer blocks.");
      return;
    }

    const result = await clearReviewAuthorBlocks();
    setDataMessage(result.message);
  }

  async function handleOpenLegalPage(page: LegalPageName) {
    setLegalMessage(null);
    const result = await openLegalPage(page);
    setLegalMessage(result.message);
  }

  async function handleContactSupport() {
    setLegalMessage(null);

    try {
      if (!(await Linking.canOpenURL(supportMailUrl))) {
        setLegalMessage(`No email app is available. Contact ${supportEmail} manually.`);
        return;
      }

      await Linking.openURL(supportMailUrl);
      setLegalMessage("Opened your email app.");
    } catch {
      setLegalMessage(`Could not open email. Contact ${supportEmail} manually.`);
    }
  }

  async function handleOpenVenueAttribution() {
    setLegalMessage(null);

    try {
      if (!(await Linking.canOpenURL(venueMetadataAttribution.url))) {
        setLegalMessage("This device could not open the venue-data attribution page.");
        return;
      }

      await Linking.openURL(venueMetadataAttribution.url);
      setLegalMessage(`Venue metadata attribution: ${venueMetadataAttribution.label}, ${venueMetadataAttribution.license}.`);
    } catch {
      setLegalMessage("Could not open the venue-data attribution page.");
    }
  }

  async function handleResetLocalData() {
    setIsResetting(true);

    try {
      await Promise.all([clearSaved(), resetSettings(), resetMusicSettings()]);
      setDataMessage("My spots and preferences were reset on this device.");
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "Could not clear all local data.");
    } finally {
      setIsResetting(false);
    }
  }

  async function handleExportData() {
    setIsExporting(true);
    setDataMessage(null);

    try {
      if (sessionError) {
        setDataMessage(sessionError);
        return;
      }

      let serverData: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
        privateDeviceSessionId: null,
        serverContributions: []
      };

      if (user) {
        const result = await getDeviceDataExport(user.id);

        if (!result.ok || !result.data) {
          setDataMessage(result.message);
          return;
        }

        serverData = result.data;
      }

      await Share.share({
        message: JSON.stringify({
          ...serverData,
          accountEmail: hasPermanentAccount ? user?.email ?? null : null,
          accountProviders: hasPermanentAccount ? accountProviders : [],
          localData: {
            musicPromptEnabled: musicSettings.promptEnabled,
            mySpotSlugs: [...savedVenueSlugs],
            settings
          }
        }, null, 2),
        title: "Riento data export"
      });
      setDataMessage("Riento data export prepared.");
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "Could not prepare the data export.");
    } finally {
      setIsExporting(false);
    }
  }

  function confirmDeleteData() {
    if (sessionError) {
      setDataMessage(sessionError);
      return;
    }

    Alert.alert(
      hasPermanentAccount ? "Delete account and Riento data?" : "Delete Riento data?",
      hasPermanentAccount
        ? "This permanently deletes the account, its ratings and reviews, other contributions, and local My spots and preferences."
        : "This permanently deletes contributions linked to this installation and clears My spots and preferences from this device.",
      [
        { style: "cancel", text: "Cancel" },
        { onPress: handleDeleteData, style: "destructive", text: "Delete data" }
      ]
    );
  }

  function confirmDeleteAnonymousSession() {
    Alert.alert(
      "Delete private session to sign in?",
      "This permanently deletes only this anonymous backend identity and its Riento contributions. My spots and preferences stay on this device. You can then sign in yourself; Riento will not sign in automatically.",
      [
        { style: "cancel", text: "Cancel" },
        { onPress: handleDeleteAnonymousSession, style: "destructive", text: "Delete private session" }
      ]
    );
  }

  function confirmResetUnverifiedIdentity() {
    Alert.alert(
      "Reset unavailable session?",
      "This removes the unavailable identity from this device so you can use Riento again. It does not delete any inaccessible server data. If this was an email account, sign back in afterward to regain access.",
      [
        { style: "cancel", text: "Cancel" },
        { onPress: () => runAccountAction(resetUnverifiedIdentity), style: "destructive", text: "Reset session" }
      ]
    );
  }

  async function handleDeleteAnonymousSession() {
    if (!currentUserRef.current?.is_anonymous) {
      setAccountMessage("The private session changed and was not deleted. Check the current account state before trying again.");
      return;
    }

    setIsDeletingAnonymousSession(true);
    setAccountMessage(null);

    try {
      const confirmedUserId = currentUserRef.current.id;
      const result = await runExclusiveAuthOperation(
        async () => {
          const deletion = await deleteDeviceData(
            confirmedUserId,
            true,
            undefined,
            getProviderSubjects(currentUserRef.current),
            undefined,
            false
          );

          if (!deletion.ok) {
            return deletion;
          }

          return finalizeDeviceDataDeletion();
        }
      );

      if (result.ok) {
        setAccountPassword("");
      }

      setAccountMessage(result.ok
        ? "The private session and its server contributions were deleted. My spots and preferences remain. You can now sign in below."
        : result.message);
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Could not delete the private session.");
    } finally {
      setIsDeletingAnonymousSession(false);
    }
  }

  async function handleDeleteData() {
    setIsDeleting(true);
    setDataMessage(null);

    try {
      await runExclusiveAuthOperation(performDeleteData);
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "Could not finish deleting all Riento data.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function performDeleteData() {
      if (sessionError) {
        setDataMessage(sessionError);
        return;
      }

      const userAtConfirmation = user;
      const confirmedUser = currentUserRef.current;

      if ((userAtConfirmation?.id ?? null) !== (confirmedUser?.id ?? null)) {
        setDataMessage("The signed-in identity changed after deletion was confirmed. Check the current account before trying again.");
        return;
      }

      const expectedProviderSubjects = getProviderSubjects(confirmedUser);
      let appleAuthorizationCode: string | undefined;
      let appleNonce: string | undefined;

      if (confirmedUser && !confirmedUser.is_anonymous && accountProviders.includes("apple")) {
        try {
          const credential = await requestAppleCredential();

          if (!credential.authorizationCode) {
            throw new Error("Apple did not return a revocation code.");
          }

          appleAuthorizationCode = credential.authorizationCode;
          appleNonce = credential.nonce;
        } catch (error) {
          if (isSocialAuthCancellation(error)) {
            setDataMessage("Apple verification was cancelled, so the account was not deleted.");
            return;
          }

          // Server deletion remains available and reports the manual Apple cleanup fallback.
        }
      }

      if (confirmedUser && (currentUserRef.current?.id !== confirmedUser.id
        || getProviderSubjects(currentUserRef.current).join(",") !== expectedProviderSubjects.join(","))) {
        setDataMessage("The signed-in identity changed while deletion was being prepared. Check the current account before trying again.");
        return;
      }

      if (confirmedUser) {
        const result = await deleteDeviceData(
          confirmedUser.id,
          confirmedUser.is_anonymous === true,
          appleAuthorizationCode,
          expectedProviderSubjects,
          appleNonce,
          true
        );

        if (!result.ok) {
          setDataMessage(result.message);
          return;
        }

        const finalization = await finalizeDeviceDataDeletion();
        setDataMessage(finalization.message);
        return;
      }

      const resumedDeletion = await resumePendingDeviceDataDeletion();

      if (resumedDeletion) {
        if (!resumedDeletion.ok) {
          setDataMessage(resumedDeletion.message);
          return;
        }

        const finalization = await finalizeDeviceDataDeletion();
        setDataMessage(finalization.message);
        return;
      }

      const identityCheck = await verifyNoUnavailableIdentity();

      if (!identityCheck.ok) {
        setDataMessage(`${identityCheck.message} Local data was not cleared, and Riento does not claim that inaccessible server data was deleted.`);
        return;
      }

      if (currentUserRef.current) {
        setDataMessage("A private identity appeared while local deletion was being prepared. Nothing was deleted; review the current account and try again.");
        return;
      }

      await Promise.all([clearSaved(), resetSettings(), resetMusicSettings()]);
      setDataMessage((currentMessage) => currentMessage ?? (hasPermanentAccount ? "The account and its Riento data were deleted." : "Riento data was deleted. You can keep browsing without creating a new private session."));
  }

  const localSettingsLoading = settingsLoading || musicSettingsLoading;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>Settings</Text>
        <Text style={styles.title}>Your device, your controls.</Text>
        <Text style={styles.subtitle}>Browsing, ratings, crowd signals, and music sharing need no account. An optional account enables written venue reviews.</Text>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Optional review account</Text>
          {sessionLoading ? (
            <Text accessibilityLiveRegion="polite" style={styles.sectionText}>Checking this device...</Text>
          ) : sessionError ? (
            <>
              <Text style={styles.sectionText}>Riento cannot verify the identity previously saved on this device. Account, contribution, export, and full deletion controls stay blocked to avoid acting on the wrong identity.</Text>
              <Pressable accessibilityHint="Does not delete inaccessible server data" accessibilityLabel="Reset unavailable saved session" accessibilityRole="button" accessibilityState={{ disabled: isAccountOperationRunning }} disabled={isAccountOperationRunning} onPress={confirmResetUnverifiedIdentity} style={[styles.dangerButton, isAccountOperationRunning && styles.buttonDisabled]}>
                <Text style={styles.dangerButtonText}>Reset unavailable session</Text>
              </Pressable>
            </>
          ) : isPasswordRecovery ? (
            <>
              <Text style={styles.sectionText}>Enter a new password for the account opened from the reset link.</Text>
              <TextInput
                accessibilityLabel="New account password"
                autoCapitalize="none"
                onChangeText={setAccountPassword}
                placeholder="New password (8+ characters)"
                placeholderTextColor={colors.muted}
                secureTextEntry
                style={styles.accountInput}
                value={accountPassword}
              />
              <Pressable accessibilityLabel="Update recovered account password" accessibilityRole="button" accessibilityState={{ disabled: isAccountBusy }} disabled={isAccountBusy} onPress={() => runAccountAction(() => completePasswordRecovery(accountPassword))} style={[styles.secondaryButton, isAccountBusy && styles.buttonDisabled]}>
                <Text style={styles.secondaryButtonText}>Update password</Text>
              </Pressable>
            </>
          ) : hasPermanentAccount ? (
            <>
              <Text style={styles.sectionText}>Signed in with {formatAccountProviders(accountProviders)}{user?.email ? ` as ${user.email}` : ""}. Written reviews are enabled and new text is held for moderation before publication.</Text>
              {isAdmin && (
                <View style={styles.existingAccountCard}>
                  <Text style={styles.infoTitle}>Admin access active</Text>
                  <Text style={styles.infoText}>Trending controls are in Top → Trending. Temporary activity controls are on each venue's detail page.</Text>
                  <Pressable accessibilityLabel="Open Trending controls" accessibilityRole="button" onPress={() => router.push("/leaderboard")} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Open Top</Text>
                  </Pressable>
                </View>
              )}
              {hasEmailAccount && (
                <>
                  <TextInput
                    accessibilityLabel="Account password"
                    autoCapitalize="none"
                    onChangeText={setAccountPassword}
                    placeholder="Set or update password (8+ characters)"
                    placeholderTextColor={colors.muted}
                    secureTextEntry
                    style={styles.accountInput}
                    value={accountPassword}
                  />
                  <Pressable accessibilityLabel="Set account password" accessibilityRole="button" accessibilityState={{ disabled: isAccountBusy }} disabled={isAccountBusy} onPress={() => runAccountAction(() => updateAccountPassword(accountPassword))} style={[styles.secondaryButton, isAccountBusy && styles.buttonDisabled]}>
                    <Text style={styles.secondaryButtonText}>Set account password</Text>
                  </Pressable>
                </>
              )}
              <Pressable accessibilityLabel="Sign out of review account" accessibilityRole="button" accessibilityState={{ disabled: isAccountBusy }} disabled={isAccountBusy} onPress={() => runAccountAction(signOut)} style={[styles.secondaryButton, isAccountBusy && styles.buttonDisabled]}>
                <Text style={styles.secondaryButtonText}>Sign out</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.sectionText}>{pendingAccountEmail
                ? `${pendingAccountEmail} is unexpectedly waiting for verification. Check your inbox or contact support.`
                : isAnonymous
                  ? "Create an email account to preserve this private session and add written reviews, or use the existing-account path below. Number-only ratings remain account-free."
                  : "New here? Create an account, then set a password. Already have an account? Enter its email and password and choose Sign in."}</Text>
              {!pendingAccountEmail && Platform.OS !== "web" && (
                <>
                  <View style={styles.socialActions}>
                    <GoogleAccountButton disabled={isAccountBusy} onPress={() => runAccountAction(signInWithGoogle)} />
                    {Platform.OS === "ios" && (
                      <AppleAuthentication.AppleAuthenticationButton
                        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
                        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                        cornerRadius={12}
                        onPress={() => {
                          if (!isAccountBusy) {
                            runAccountAction(signInWithApple);
                          }
                        }}
                        style={[styles.appleButton, isAccountBusy && styles.buttonDisabled]}
                      />
                    )}
                  </View>
                  <View style={styles.accountDivider}>
                    <View style={styles.accountDividerLine} />
                    <Text style={styles.accountDividerText}>or use email</Text>
                    <View style={styles.accountDividerLine} />
                  </View>
                </>
              )}
              <TextInput
                accessibilityLabel="Review account email"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setAccountEmail}
                placeholder="Email"
                placeholderTextColor={colors.muted}
                style={styles.accountInput}
                value={accountEmail}
              />
              {!user && (
                <TextInput
                  accessibilityLabel="Review account password"
                  autoCapitalize="none"
                  autoComplete="password"
                  onChangeText={setAccountPassword}
                  placeholder="Password for Sign in only"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  style={styles.accountInput}
                  value={accountPassword}
                />
              )}
              <View style={styles.accountActions}>
                <Pressable accessibilityLabel="Create review account" accessibilityRole="button" accessibilityState={{ disabled: isAccountBusy }} disabled={isAccountBusy} onPress={() => runAccountAction(() => createAccount(accountEmail))} style={[styles.secondaryButton, styles.accountAction, isAccountBusy && styles.buttonDisabled]}>
                  <Text style={styles.secondaryButtonText}>Create account</Text>
                </Pressable>
                {!user && (
                  <Pressable accessibilityLabel="Sign in to existing review account" accessibilityRole="button" accessibilityState={{ disabled: isAccountBusy }} disabled={isAccountBusy} onPress={() => runAccountAction(() => signIn(accountEmail, accountPassword))} style={[styles.secondaryButton, styles.accountAction, isAccountBusy && styles.buttonDisabled]}>
                    <Text style={styles.secondaryButtonText}>Sign in</Text>
                  </Pressable>
                )}
              </View>
              {isAnonymous && (
                <View style={styles.existingAccountCard}>
                  <Text style={styles.infoTitle}>Already have an account?</Text>
                  <Text style={styles.infoText}>Direct sign-in is blocked while this private session may own contributions. To use an existing account, permanently delete only this anonymous backend identity and its contributions. My spots and preferences will stay on this device.</Text>
                  <Pressable accessibilityHint="Requires destructive confirmation and preserves My spots and preferences" accessibilityLabel="Delete private session to use an existing account" accessibilityRole="button" accessibilityState={{ disabled: isAccountBusy }} disabled={isAccountBusy} onPress={confirmDeleteAnonymousSession} style={[styles.dangerButton, isAccountBusy && styles.buttonDisabled]}>
                    <Text style={styles.dangerButtonText}>{isDeletingAnonymousSession ? "Deleting private session..." : "Delete private session to sign in"}</Text>
                  </Pressable>
                </View>
              )}
              {!user && (
                <Pressable accessibilityLabel="Reset password for existing review account" accessibilityRole="button" accessibilityState={{ disabled: isAccountBusy }} disabled={isAccountBusy} onPress={() => runAccountAction(() => sendPasswordReset(accountEmail))} style={[styles.textButtonTarget, isAccountBusy && styles.buttonDisabled]}>
                  <Text style={styles.textButton}>Forgot password?</Text>
                </Pressable>
              )}
            </>
          )}
          {(accountMessage || authCallbackMessage) && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{accountMessage ?? authCallbackMessage}</Text>}
          {sessionError && <Text accessibilityLiveRegion="polite" style={styles.errorText}>{sessionError}</Text>}
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>My spots</Text>
          <Text style={styles.sectionText}>{savedLoading ? "Loading saved venues..." : `${savedVenueSlugs.size} ${savedVenueSlugs.size === 1 ? "venue" : "venues"} saved on this device.`}</Text>
          <Pressable accessibilityLabel="Clear My spots from this device" accessibilityRole="button" accessibilityState={{ disabled: savedLoading || savedVenueSlugs.size === 0 }} disabled={savedLoading || savedVenueSlugs.size === 0} onPress={handleClearMySpots} style={[styles.secondaryButton, (savedLoading || savedVenueSlugs.size === 0) && styles.buttonDisabled]}>
            <Text style={styles.secondaryButtonText}>Clear My spots</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Foreground location</Text>
          {settingsError && <Text accessibilityLiveRegion="polite" style={styles.errorText}>{settingsError}</Text>}
          <SettingRow
            description="On by default for new installs. Each cold app session offers a foreground venue and song check. It shares only the matched venue-level signal after you tap Check, not your exact coordinates."
            disabled={settingsLoading}
            label="Offer check on app open"
            onValueChange={setGpsOnMapOpen}
            value={settings.gpsOnMapOpen}
          />
          <SettingRow
            description="Let you explicitly choose a venue when GPS is unavailable or inaccurate."
            disabled={settingsLoading}
            label="Manual placement"
            onValueChange={setManualPlacementEnabled}
            value={settings.manualPlacementEnabled}
          />
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Music recognition</Text>
          {musicSettingsError && <Text accessibilityLiveRegion="polite" style={styles.errorText}>{musicSettingsError}</Text>}
          <SettingRow
            description="Offer an optional foreground music check after you place yourself at a venue. Microphone access still requires an explicit tap."
            disabled={musicSettingsLoading}
            label="Music prompt after placement"
            onValueChange={setPromptEnabled}
            value={musicSettings.promptEnabled}
          />
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Foreground only</Text>
            <Text style={styles.infoText}>Riento never listens in the background and does not store raw audio.</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Privacy</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>No public user dots</Text>
            <Text style={styles.infoText}>Only venue-level crowd and music signals are public. Exact locations and private device-session identifiers are never shown.</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>{hasPermanentAccount ? "Review account" : "Private device session"}</Text>
            <Text style={styles.infoText}>{sessionLoading ? "Checking this installation..." : hasPermanentAccount ? "This account can publish moderated written reviews and is also used for contribution cooldowns and data controls." : user ? "This installation has a random private backend session used only for contributions, cooldowns, and data controls." : "No backend identity has been created. Riento creates one only when you first submit data."}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Data controls</Text>
          <Text style={styles.sectionText}>Export includes this installation's server contributions plus local My spots and preferences.</Text>
          <Pressable accessibilityLabel="Export my Riento data" accessibilityRole="button" accessibilityState={{ disabled: isExporting || isAuthBusy || sessionLoading || savedLoading || localSettingsLoading || Boolean(sessionError) }} disabled={isExporting || isAuthBusy || sessionLoading || savedLoading || localSettingsLoading || Boolean(sessionError)} onPress={handleExportData} style={[styles.secondaryButton, (isExporting || isAuthBusy || sessionLoading || savedLoading || localSettingsLoading || Boolean(sessionError)) && styles.buttonDisabled]}>
            <Text style={styles.secondaryButtonText}>{isExporting ? "Preparing..." : "Export my Riento data"}</Text>
          </Pressable>
          <Pressable accessibilityLabel="Clear My spots and preferences" accessibilityRole="button" accessibilityState={{ disabled: isResetting || localSettingsLoading }} disabled={isResetting || localSettingsLoading} onPress={handleResetLocalData} style={[styles.secondaryButton, (isResetting || localSettingsLoading) && styles.buttonDisabled]}>
            <Text style={styles.secondaryButtonText}>{isResetting ? "Resetting..." : "Clear My spots and preferences"}</Text>
          </Pressable>
          <Pressable accessibilityLabel="Clear blocked reviewers" accessibilityRole="button" accessibilityState={{ disabled: sessionLoading }} disabled={sessionLoading} onPress={handleClearReviewBlocks} style={[styles.secondaryButton, sessionLoading && styles.buttonDisabled]}>
            <Text style={styles.secondaryButtonText}>Clear blocked reviewers</Text>
          </Pressable>
          <Pressable accessibilityHint="Requires destructive confirmation" accessibilityLabel={hasPermanentAccount ? "Delete account and all Riento data" : "Delete all Riento data"} accessibilityRole="button" accessibilityState={{ disabled: isAccountBusy || sessionLoading }} disabled={isAccountBusy || sessionLoading} onPress={confirmDeleteData} style={[styles.dangerButton, (isAccountBusy || sessionLoading) && styles.buttonDisabled]}>
            <Text style={styles.dangerButtonText}>{isDeleting ? "Deleting..." : hasPermanentAccount ? "Delete account and all Riento data" : "Delete all Riento data"}</Text>
          </Pressable>
          {dataMessage && <Text accessibilityLiveRegion="polite" style={styles.messageText}>{dataMessage}</Text>}
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Legal and support</Text>
          <Text style={styles.sectionText}>Read the policies that apply to optional accounts, written reviews, location, microphone use, moderation, and deletion.</Text>
          <Text style={styles.sectionText}>Venue metadata: OpenStreetMap contributors / ODbL.</Text>
          <View style={styles.legalLinks}>
            <Pressable accessibilityLabel="Open Privacy Policy" accessibilityRole="link" onPress={() => handleOpenLegalPage(legalPages.privacyPolicy)} style={styles.legalLink}><Text style={styles.legalLinkText}>Privacy Policy</Text></Pressable>
            <Pressable accessibilityLabel="Open Terms" accessibilityRole="link" onPress={() => handleOpenLegalPage(legalPages.terms)} style={styles.legalLink}><Text style={styles.legalLinkText}>Terms</Text></Pressable>
            <Pressable accessibilityLabel="Open Community Guidelines" accessibilityRole="link" onPress={() => handleOpenLegalPage(legalPages.communityGuidelines)} style={styles.legalLink}><Text style={styles.legalLinkText}>Community Guidelines</Text></Pressable>
            <Pressable accessibilityLabel="Open Data Deletion information" accessibilityRole="link" onPress={() => handleOpenLegalPage(legalPages.accountDeletion)} style={styles.legalLink}><Text style={styles.legalLinkText}>Data Deletion</Text></Pressable>
            <Pressable accessibilityLabel="Open hosted Support page" accessibilityRole="link" onPress={() => handleOpenLegalPage(legalPages.support)} style={styles.legalLink}><Text style={styles.legalLinkText}>Support Page</Text></Pressable>
            <Pressable accessibilityLabel="Open OpenStreetMap venue-data attribution" accessibilityRole="link" onPress={handleOpenVenueAttribution} style={styles.legalLink}><Text style={styles.legalLinkText}>Venue Data Credits</Text></Pressable>
            <Pressable accessibilityLabel={`Email support at ${supportEmail}`} accessibilityRole="link" onPress={handleContactSupport} style={styles.legalLink}><Text style={styles.legalLinkText}>Email Support</Text></Pressable>
          </View>
          {legalMessage && <Text accessibilityLiveRegion="polite" selectable style={styles.messageText}>{legalMessage}</Text>}
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Venue coverage</Text>
          <Text style={styles.sectionText}>Help improve Helsinki coverage by privately reporting a missing bar or club.</Text>
          <Pressable accessibilityLabel="Report a missing venue" accessibilityRole="button" onPress={() => router.push({ pathname: "/report-venue" })} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Report missing venue</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

type SettingRowProps = {
  description: string;
  disabled: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
};

function SettingRow({ description, disabled, label, onValueChange, value }: SettingRowProps) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDescription}>{description}</Text>
      </View>
      <Switch
        accessibilityHint={description}
        accessibilityLabel={label}
        disabled={disabled}
        hitSlop={8}
        onValueChange={onValueChange}
        thumbColor={value ? colors.text : colors.muted}
        trackColor={{ false: colors.surfaceElevated, true: colors.accentSoft }}
        value={value}
      />
    </View>
  );
}

function GoogleAccountButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return (
      <Pressable accessibilityLabel="Continue with Google" accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.googleFallbackButton, disabled && styles.buttonDisabled]}>
        <Text style={styles.googleFallbackIcon}>G</Text>
        <Text style={styles.googleFallbackText}>Continue with Google</Text>
      </Pressable>
    );
  }

  const { GoogleSigninButton } = require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin");
  return (
    <GoogleSigninButton
      color={GoogleSigninButton.Color.Dark}
      disabled={disabled}
      onPress={onPress}
      size={GoogleSigninButton.Size.Wide}
      style={styles.googleButton}
    />
  );
}

function formatAccountProviders(providers: Array<"apple" | "email" | "google">) {
  const labels = providers.map((provider) => provider === "apple" ? "Apple" : provider === "google" ? "Google" : "email");

  if (labels.length < 2) {
    return labels[0] ?? "a verified account";
  }

  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function getProviderSubjects(user: User | null | undefined) {
  return (user?.identities ?? [])
    .map((identity) => {
      const subject = identity.identity_data?.sub;
      return `${identity.provider}:${typeof subject === "string" ? subject : identity.id}`;
    })
    .sort();
}

const styles = StyleSheet.create({
  accountDivider: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  accountDividerLine: {
    backgroundColor: colors.border,
    flex: 1,
    height: 1
  },
  accountDividerText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  accountAction: {
    flex: 1
  },
  accountActions: {
    flexDirection: "row",
    gap: 10
  },
  accountInput: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  appleButton: {
    height: 48,
    width: "100%"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  content: {
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 18
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    borderColor: "rgba(239, 68, 68, 0.42)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingVertical: 14
  },
  dangerButtonText: {
    color: colors.rose,
    fontSize: 14,
    fontWeight: "800"
  },
  errorText: {
    color: colors.rose,
    fontSize: 13,
    lineHeight: 19
  },
  existingAccountCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: "rgba(239, 68, 68, 0.42)",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14
  },
  infoCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 14
  },
  infoText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  infoTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800"
  },
  googleButton: {
    height: 48,
    width: "100%"
  },
  googleFallbackButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    flexDirection: "row",
    height: 48,
    justifyContent: "center",
    position: "relative",
    width: "100%"
  },
  googleFallbackIcon: {
    color: "#4285F4",
    fontSize: 18,
    fontWeight: "900",
    left: 16,
    position: "absolute"
  },
  googleFallbackText: {
    color: "#1F1F1F",
    fontSize: 14,
    fontWeight: "700"
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.8,
    textTransform: "uppercase"
  },
  legalLink: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  legalLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  legalLinkText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  messageText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingVertical: 14
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800"
  },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    marginTop: 16,
    padding: 18
  },
  sectionText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "800"
  },
  socialActions: {
    gap: 10
  },
  settingCopy: {
    flex: 1,
    paddingRight: 14
  },
  settingDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4
  },
  settingLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800"
  },
  settingRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 12
  },
  textButton: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center"
  },
  textButtonTarget: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48
  },
  title: {
    color: colors.text,
    fontSize: 39,
    fontWeight: "900",
    letterSpacing: -1.3,
    lineHeight: 43,
    marginTop: 8
  }
});
