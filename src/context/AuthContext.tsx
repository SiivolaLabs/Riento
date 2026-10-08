import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { AppState, Platform } from "react-native";

import {
  authStateStorage,
  clearAuthIdentityMarker,
  hasAuthIdentityMarker,
  isSupabaseConfigured,
  markAuthIdentityPresent,
  missingSupabaseMessage,
  supabase
} from "../lib/supabase";
import {
  clearGoogleLocalSession,
  isSocialAuthCancellation,
  requestAppleCredential,
  requestGoogleCredential,
  revokeGoogleAccess,
  type SocialProviderCredential
} from "../services/socialAuthService";
import {
  clearPendingDeletionLocalData,
  clearPendingDeviceDataDeletion,
  getPendingDeviceDataDeletion,
  resumePendingDeviceDataDeletion,
  updatePendingGoogleRevocationStatus
} from "../services/profileService";

type DeviceSessionResult =
  | { message: string; ok: true; user: User }
  | { message: string; ok: false; user: null };

type AuthActionResult = { message: string; ok: boolean };
type AccountProvider = "apple" | "email" | "google";
type ExclusiveAuthOperation = <T>(operation: () => Promise<T>) => Promise<T>;

type AuthContextValue = {
  accountProviders: AccountProvider[];
  authCallbackMessage: string | null;
  completePasswordRecovery: (password: string) => Promise<AuthActionResult>;
  createAccount: (email: string) => Promise<AuthActionResult>;
  ensureDeviceSession: () => Promise<DeviceSessionResult>;
  finalizeDeviceDataDeletion: () => Promise<AuthActionResult>;
  isAdmin: boolean;
  isAnonymous: boolean;
  isAuthBusy: boolean;
  isConfigured: boolean;
  isLoading: boolean;
  isPasswordRecovery: boolean;
  refreshAdminStatus: () => Promise<AuthActionResult>;
  resetUnverifiedIdentity: () => Promise<AuthActionResult>;
  runExclusiveAuthOperation: ExclusiveAuthOperation;
  sendPasswordReset: (email: string) => Promise<AuthActionResult>;
  session: Session | null;
  sessionError: string | null;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signInWithApple: () => Promise<AuthActionResult>;
  signInWithGoogle: () => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
  updateAccountPassword: (password: string) => Promise<AuthActionResult>;
  user: User | null;
  verifyNoUnavailableIdentity: () => Promise<AuthActionResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const pendingAccountLinkKey = "riento.pendingAccountLink.v1";
const pendingPasswordRecoveryKey = "riento.pendingPasswordRecovery.v1";
const webIntentionalSignOutKey = "riento.intentionalWebSignOut.v1";

export function AuthProvider({ children }: PropsWithChildren) {
  const [authCallbackMessage, setAuthCallbackMessage] = useState<string | null>(null);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionInitialization] = useState(() => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      resolve = () => done();
    });

    return { promise, resolve };
  });
  const pendingDeviceSession = useRef<Promise<DeviceSessionResult> | null>(null);
  const appleRevocationInFlightRef = useRef<string | null>(null);
  const adminStatusRequestIdRef = useRef(0);
  const authMutationGenerationRef = useRef(0);
  const authMutationRef = useRef<Promise<unknown> | null>(null);
  const intentionalSignOutDepthRef = useRef(0);
  const sessionInitializationFailedRef = useRef(false);
  const sessionErrorRef = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const accountProviders = getAccountProviders(session?.user);
  const accountProviderKey = accountProviders.join(",");

  async function runExclusiveAuthOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previousOperation = authMutationRef.current;
    let currentOperation: Promise<T>;

    currentOperation = (async () => {
      if (previousOperation) {
        await previousOperation.catch(() => undefined);
      }

      setIsAuthBusy(true);

      try {
        return await operation();
      } finally {
        authMutationGenerationRef.current += 1;
        setIsAuthBusy(false);
      }
    })();
    authMutationRef.current = currentOperation;

    try {
      return await currentOperation;
    } finally {
      if (authMutationRef.current === currentOperation) {
        authMutationRef.current = null;
      }
    }
  }

  async function signOutLocalSession() {
    if (!supabase) {
      throw new Error(missingSupabaseMessage);
    }

    intentionalSignOutDepthRef.current += 1;
    const shareSignOutIntent = Platform.OS === "web";

    try {
      if (shareSignOutIntent) {
        await authStateStorage.setItem(webIntentionalSignOutKey, Date.now().toString());
      }

      const result = await supabase.auth.signOut({ scope: "local" });

      if (result.error && shareSignOutIntent) {
        await authStateStorage.removeItem(webIntentionalSignOutKey);
        await markAuthIdentityPresent();
      } else if (shareSignOutIntent) {
        await clearAuthIdentityMarker();
        await authStateStorage.removeItem(webIntentionalSignOutKey);
      }

      return result;
    } catch (error) {
      if (shareSignOutIntent) {
        await authStateStorage.removeItem(webIntentionalSignOutKey).catch(() => undefined);
        await markAuthIdentityPresent().catch(() => undefined);
      }

      throw error;
    } finally {
      intentionalSignOutDepthRef.current = Math.max(0, intentionalSignOutDepthRef.current - 1);
    }
  }

  async function getUnavailableIdentityMessage(currentSession: Session | null) {
    if (currentSession) {
      return null;
    }

    let hadPersistedIdentity: boolean;

    try {
      hadPersistedIdentity = await hasAuthIdentityMarker();
    } catch {
      hadPersistedIdentity = true;
    }

    if (!hadPersistedIdentity) {
      return null;
    }

    const message = "The saved identity no longer has a verifiable session. Reset it explicitly before creating or signing in to another account.";
    sessionInitializationFailedRef.current = true;
    sessionErrorRef.current = message;
    setSessionError(message);
    return message;
  }

  const refreshAdminStatus = useCallback(async (): Promise<AuthActionResult> => {
    const requestId = ++adminStatusRequestIdRef.current;
    const client = supabase;
    const currentUser = sessionRef.current?.user;

    if (!client || !currentUser || currentUser.is_anonymous) {
      setAdminUserId(null);
      return { ok: false, message: "A permanent account is required for admin access." };
    }

    const userId = currentUser.id;
    setAdminUserId(null);

    try {
      const { data, error } = await client.rpc("get_admin_status");

      if (requestId !== adminStatusRequestIdRef.current || sessionRef.current?.user.id !== userId) {
        return { ok: false, message: "The signed-in account changed while admin access was checked." };
      }

      if (error) {
        return { ok: false, message: error.message };
      }

      setAdminUserId(data === true ? userId : null);
      return {
        ok: data === true,
        message: data === true ? "Admin access ready." : "This account does not have admin access."
      };
    } catch (error) {
      if (requestId !== adminStatusRequestIdRef.current) {
        return { ok: false, message: "A newer admin access check replaced this request." };
      }

      return {
        ok: false,
        message: error instanceof Error ? error.message : "Could not check admin access."
      };
    }
  }, []);

  useEffect(() => {
    if (!supabase || Platform.OS === "web") {
      return;
    }

    const client = supabase;
    const updateRefresh = (state: string) => {
      if (state === "active") {
        client.auth.startAutoRefresh();
        void refreshAdminStatus();
      } else {
        client.auth.stopAutoRefresh();
      }
    };
    const subscription = AppState.addEventListener("change", updateRefresh);
    updateRefresh(AppState.currentState);

    return () => {
      subscription.remove();
      client.auth.stopAutoRefresh();
    };
  }, [refreshAdminStatus]);

  useEffect(() => {
    const client = supabase;

    if (!client) {
      sessionInitialization.resolve();
      setIsLoading(false);
      return;
    }

    let active = true;
    let authUrlQueue = Promise.resolve();
    let sessionInitializationComplete = false;
    let startupAuthEvent: { allowSignedOut: boolean; event: string; nextSession: Session | null } | null = null;
    const handledAuthCodes = new Set<string>();

    const applyAuthStateChange = (event: string, nextSession: Session | null, allowSignedOut = false) => {
      if (!active
        || sessionInitializationFailedRef.current
        || (event === "SIGNED_OUT" && sessionErrorRef.current)) {
        return;
      }

      if (event === "SIGNED_OUT" && intentionalSignOutDepthRef.current === 0 && !allowSignedOut) {
        if (Platform.OS === "web") {
          setTimeout(() => {
            Promise.all([
              hasAuthIdentityMarker(),
              authStateStorage.getItem(webIntentionalSignOutKey),
              client.auth.getSession()
            ]).then(([hadPersistedIdentity, signOutStartedAt, currentSessionResult]) => {
              if (!active || currentSessionResult.data.session) {
                return;
              }

              const signOutAge = Date.now() - Number(signOutStartedAt);
              const sharedIntentIsCurrent = signOutStartedAt !== null
                && Number.isFinite(signOutAge)
                && signOutAge >= 0
                && signOutAge < 10_000;

              if (!hadPersistedIdentity || sharedIntentIsCurrent) {
                applyAuthStateChange(event, nextSession, true);
                return;
              }

              markUnexpectedSignOut();
            }).catch(markUnexpectedSignOut);
          }, 0);
          return;
        }

        markUnexpectedSignOut();
        return;
      }

      sessionRef.current = nextSession;
      setSession(nextSession);
      sessionErrorRef.current = null;
      setSessionError(null);

      if (nextSession) {
        markAuthIdentityPresent().catch(() => undefined);
      }

      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
      } else if (event === "SIGNED_OUT") {
        setIsPasswordRecovery(false);
        Promise.all([
          authStateStorage.removeItem(pendingAccountLinkKey),
          authStateStorage.removeItem(pendingPasswordRecoveryKey)
        ]).catch(() => undefined);
      }
    };

    const markUnexpectedSignOut = () => {
      if (!active) {
        return;
      }

      sessionInitializationFailedRef.current = true;
      sessionRef.current = null;
      setSession(null);
      setIsPasswordRecovery(false);
      sessionErrorRef.current = "The current identity became unavailable unexpectedly. Reset the saved session explicitly before creating or signing in to another account.";
      setSessionError(sessionErrorRef.current);
    };

    const initialSession = (async () => {
      const resumedDeletion = await resumePendingDeviceDataDeletion();

      if (resumedDeletion?.state === "completed") {
        const finalization = await finalizeDeviceDataDeletion();

        if (active) {
          setAuthCallbackMessage(finalization.message);
        }
      }

      const { data, error } = await client.auth.getSession();

      if (error) {
        throw error;
      }

      const hadPersistedIdentity = await hasAuthIdentityMarker();

      const deletionCanReplaceSavedIdentity = resumedDeletion?.state === "processing"
        || resumedDeletion?.state === "completed";

      if (!data.session && hadPersistedIdentity && !deletionCanReplaceSavedIdentity) {
        throw new Error("The saved identity no longer has a verifiable session.");
      }

      if (data.session) {
        await markAuthIdentityPresent();
      }

      if (active) {
        sessionRef.current = data.session;
        setSession(data.session);
        sessionErrorRef.current = null;
        setSessionError(null);

        if (resumedDeletion?.state === "processing") {
          setAuthCallbackMessage(resumedDeletion.message);
        }
      }
    })().catch((error: unknown) => {
      if (active) {
        sessionInitializationFailedRef.current = true;
        sessionRef.current = null;
        setSession(null);
        sessionErrorRef.current = error instanceof Error
          ? error.message
          : "The saved session could not be verified. Restart Riento before using account or deletion controls.";
        setSessionError(sessionErrorRef.current);
      }
    }).finally(() => {
      if (active) {
        sessionInitializationComplete = true;
        if (startupAuthEvent && !sessionInitializationFailedRef.current) {
          applyAuthStateChange(startupAuthEvent.event, startupAuthEvent.nextSession, startupAuthEvent.allowSignedOut);
          startupAuthEvent = null;
        }
        sessionInitialization.resolve();
        setIsLoading(false);
      }
    });

    const { data: authListener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) {
        return;
      }

      if (event === "INITIAL_SESSION") {
        return;
      }

      if (!sessionInitializationComplete) {
        startupAuthEvent = {
          allowSignedOut: event === "SIGNED_OUT" && intentionalSignOutDepthRef.current > 0,
          event,
          nextSession
        };
        return;
      }

      applyAuthStateChange(event, nextSession);
    });

    const processAuthUrl = async (url: string) => {
      await initialSession;

      if (!active) {
        return;
      }

      if (sessionInitializationFailedRef.current) {
        setAuthCallbackMessage("Could not verify the current device session, so the account link was not opened. Try again after restarting Riento.");
        return;
      }

      const parsedUrl = Linking.parse(url);
      const code = getQueryParam(parsedUrl.queryParams?.code);
      const callbackError = getQueryParam(parsedUrl.queryParams?.error_description) ?? getQueryParam(parsedUrl.queryParams?.error);

      if (!code && !callbackError) {
        return;
      }

      const expectedCallback = Linking.parse(Linking.createURL("profile"));

      if (!isExpectedAuthCallback(parsedUrl, expectedCallback)) {
        setAuthCallbackMessage("This account link does not target Riento's Profile callback.");
        return;
      }

      if (!code) {
        if (callbackError) {
          setAuthCallbackMessage(callbackError);
        }

        return;
      }

      if (handledAuthCodes.has(code)) {
        return;
      }

      handledAuthCodes.add(code);
      const callbackType = getQueryParam(parsedUrl.queryParams?.type);
      let storedAccountEmail: string | null;
      let storedRecoveryEmail: string | null;

      try {
        [storedAccountEmail, storedRecoveryEmail] = await Promise.all([
          authStateStorage.getItem(pendingAccountLinkKey),
          authStateStorage.getItem(pendingPasswordRecoveryKey)
        ]);
      } catch (error) {
        handledAuthCodes.delete(code);
        throw error;
      }

      const pendingAccountEmail = storedAccountEmail?.trim().toLowerCase() ?? null;
      const isRecoveryCallback = callbackType === "recovery" || Boolean(storedRecoveryEmail);
      const currentSession = sessionRef.current;

      if (currentSession && !currentSession.user.is_anonymous) {
        handledAuthCodes.delete(code);
        setAuthCallbackMessage("Sign out of the current account before opening a confirmation or recovery link for another account.");
        return;
      }

      if (currentSession?.user.is_anonymous) {
        if (isRecoveryCallback) {
          handledAuthCodes.delete(code);
          setAuthCallbackMessage("This password recovery link cannot replace a private device session. Delete that session's Riento data first, then open the recovery link again.");
          return;
        }

        const pendingServerEmails = [currentSession.user.email, currentSession.user.new_email]
          .filter((email): email is string => Boolean(email))
          .map((email) => email.trim().toLowerCase());

        if (!pendingAccountEmail || !pendingServerEmails.includes(pendingAccountEmail)) {
          handledAuthCodes.delete(code);
          setAuthCallbackMessage("This account link cannot replace the current private device session. Finish its pending account upgrade, or delete its Riento data before opening a different account link.");
          return;
        }
      }

      let exchangeResult;

      try {
        exchangeResult = await client.auth.exchangeCodeForSession(code);
      } catch (error) {
        handledAuthCodes.delete(code);
        throw error;
      }

      const { error } = exchangeResult;

      if (error) {
        handledAuthCodes.delete(code);
        setAuthCallbackMessage(error.message);
        return;
      }

      await Promise.all([
        authStateStorage.removeItem(pendingAccountLinkKey),
        authStateStorage.removeItem(pendingPasswordRecoveryKey)
      ]).catch(() => undefined);

      if (isRecoveryCallback) {
        setIsPasswordRecovery(true);
        setAuthCallbackMessage("Reset link verified. Choose a new password.");
      } else {
        setAuthCallbackMessage("Email verified. Set a password below if this account was upgraded from a private device session.");
      }
    };
    const handleAuthUrl = ({ url }: { url: string }) => {
      authUrlQueue = authUrlQueue.then(() => runExclusiveAuthOperation(() => processAuthUrl(url))).catch((error: unknown) => {
        if (active) {
          setAuthCallbackMessage(error instanceof Error ? error.message : "Could not verify the account link.");
        }
      });
    };
    const urlListener = Linking.addEventListener("url", handleAuthUrl);

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleAuthUrl({ url });
      }
    }).catch(() => undefined);

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      urlListener.remove();
    };
  }, []);

  useEffect(() => {
    const currentUser = session?.user;

    setAdminUserId(null);

    if (!currentUser || currentUser.is_anonymous) {
      return;
    }

    void refreshAdminStatus();
  }, [refreshAdminStatus, session?.user.id, session?.user.is_anonymous]);

  useEffect(() => {
    if (!accountProviders.includes("apple") || !supabase) {
      return;
    }

    const client = supabase;
    const appleSubject = getProviderSubject(session?.user, "apple");
    const hasAnotherProvider = accountProviders.some((provider) => provider !== "apple");
    let active = true;
    let appStateSubscription: { remove: () => void } | null = null;
    let subscription: { remove: () => void } | null = null;

    const handleRevokedAppleSession = () => runExclusiveAuthOperation(async () => {
      const currentUser = sessionRef.current?.user;
      const currentAppleIdentity = currentUser?.identities?.find((identity) => {
        const subject = identity.identity_data?.sub ?? identity.id;
        return identity.provider === "apple" && subject === appleSubject;
      });

      if (!appleSubject || !currentAppleIdentity || appleRevocationInFlightRef.current === appleSubject) {
        return;
      }

      appleRevocationInFlightRef.current = appleSubject;

      try {
        const currentHasAnotherProvider = getAccountProviders(currentUser).some((provider) => provider !== "apple");

        if (currentHasAnotherProvider) {
          const { error: unlinkError } = await client.auth.unlinkIdentity(currentAppleIdentity);

          if (unlinkError) {
            throw unlinkError;
          }

          const { data: refreshedData, error: refreshError } = await client.auth.refreshSession();

          if (refreshError || !refreshedData.session) {
            throw refreshError ?? new Error("The account session could not be refreshed after removing Apple.");
          }

          sessionRef.current = refreshedData.session;
          setSession(refreshedData.session);
          setAuthCallbackMessage("Apple access was revoked, so the Apple sign-in method was removed. Your other account sign-in method remains active.");
          return;
        }

        const { error } = await signOutLocalSession();

        if (error) {
          throw error;
        }

        await clearAuthIdentityMarker();
      } finally {
        appleRevocationInFlightRef.current = null;
      }
    }).catch(() => {
      if (hasAnotherProvider) {
        setAuthCallbackMessage("Apple access was revoked, but Riento could not remove the Apple sign-in method. Your other account sign-in method remains active; retry after reopening the app.");
        return;
      }

      sessionInitializationFailedRef.current = true;
      sessionErrorRef.current = "Apple access was revoked, but the local Riento session could not be cleared safely. Reset the saved session before using another account.";
      setSessionError(sessionErrorRef.current);
    });

    import("expo-apple-authentication").then((AppleAuthentication) => {
      if (!active) {
        return;
      }

      const checkCredential = async () => {
        if (!appleSubject || !(await AppleAuthentication.isAvailableAsync())) {
          return;
        }

        try {
          const state = await AppleAuthentication.getCredentialStateAsync(appleSubject);

          if (state === AppleAuthentication.AppleAuthenticationCredentialState.REVOKED
            || state === AppleAuthentication.AppleAuthenticationCredentialState.NOT_FOUND) {
            await handleRevokedAppleSession();
          }
        } catch {
          // Simulator and transient platform failures must not destroy a valid session.
        }
      };

      subscription = AppleAuthentication.addRevokeListener(handleRevokedAppleSession);
      appStateSubscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          checkCredential().catch(() => undefined);
        }
      });
      checkCredential().catch(() => undefined);
    }).catch(() => undefined);

    return () => {
      active = false;
      appStateSubscription?.remove();
      subscription?.remove();
    };
  }, [accountProviderKey, session?.user.id]);

  async function createAccount(email: string): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(() => createAccountUnlocked(email));
  }

  async function createAccountUnlocked(email: string): Promise<AuthActionResult> {
    if (!supabase) {
      return { ok: false, message: missingSupabaseMessage };
    }

    if (sessionErrorRef.current) {
      return { ok: false, message: sessionErrorRef.current };
    }

    const pendingDeletionMessage = await getPendingDeletionBlockMessage();

    if (pendingDeletionMessage) {
      return { ok: false, message: pendingDeletionMessage };
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return { ok: false, message: "Enter a valid email address." };
    }

    const emailRedirectTo = Linking.createURL("profile");
    let currentSession: Session | null;

    try {
      currentSession = sessionRef.current ?? await loadCurrentSession();
    } catch {
      return { ok: false, message: "Could not verify the current device session. Restart Riento before creating an account." };
    }

    const unavailableIdentityMessage = await getUnavailableIdentityMessage(currentSession);

    if (unavailableIdentityMessage) {
      return { ok: false, message: unavailableIdentityMessage };
    }

    if (!currentSession) {
      const { data: anonymousData, error: anonymousError } = await supabase.auth.signInAnonymously();

      if (anonymousError || !anonymousData.session) {
        return { ok: false, message: anonymousError?.message ?? "Could not prepare this device for account creation." };
      }

      currentSession = anonymousData.session;
      sessionRef.current = currentSession;
      setSession(currentSession);
    }

    if (!currentSession.user.is_anonymous) {
      return { ok: false, message: "This device is already signed in to an account." };
    }

    if (currentSession.user.is_anonymous) {
      await authStateStorage.removeItem(pendingPasswordRecoveryKey);
      await authStateStorage.setItem(pendingAccountLinkKey, normalizedEmail);
      let updateResult;

      try {
        updateResult = await supabase.auth.updateUser(
          { email: normalizedEmail },
          { emailRedirectTo }
        );
      } catch (error) {
        await authStateStorage.removeItem(pendingAccountLinkKey).catch(() => undefined);
        throw error;
      }

      const { data, error } = updateResult;

      if (error) {
        await authStateStorage.removeItem(pendingAccountLinkKey).catch(() => undefined);
        return { ok: false, message: error.message };
      }

      if (data.user && !data.user.is_anonymous) {
        await authStateStorage.removeItem(pendingAccountLinkKey).catch(() => undefined);
      }

      return {
        ok: true,
        message: data.user?.is_anonymous
          ? "The account is still waiting for email verification. Check your inbox, then return here to set its password."
          : "Account created. You can now add written reviews."
      };
    }

    return { ok: false, message: "Could not prepare the optional review account." };
  }

  async function signIn(email: string, password: string): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(() => signInUnlocked(email, password));
  }

  async function signInUnlocked(email: string, password: string): Promise<AuthActionResult> {
    if (!supabase) {
      return { ok: false, message: missingSupabaseMessage };
    }

    if (sessionErrorRef.current) {
      return { ok: false, message: sessionErrorRef.current };
    }

    const pendingDeletionMessage = await getPendingDeletionBlockMessage();

    if (pendingDeletionMessage) {
      return { ok: false, message: pendingDeletionMessage };
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidAccountInput(normalizedEmail, password)) {
      return { ok: false, message: "Enter your email and password." };
    }

    let currentSession: Session | null;

    try {
      currentSession = sessionRef.current ?? await loadCurrentSession();
    } catch {
      return { ok: false, message: "Could not verify the current device session. Restart Riento before signing in." };
    }

    const unavailableIdentityMessage = await getUnavailableIdentityMessage(currentSession);

    if (unavailableIdentityMessage) {
      return { ok: false, message: unavailableIdentityMessage };
    }

    if (currentSession?.user.is_anonymous) {
      return {
        ok: false,
        message: "This private device session may already own contributions. Create an account to preserve them, or delete its Riento data before signing in to a different account."
      };
    }

    const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });

    if (error) {
      return {
        ok: false,
        message: error.code === "invalid_credentials"
          ? "Email or password was not recognized. Create the account first or reset its password."
          : error.message
      };
    }

    await Promise.all([
      authStateStorage.removeItem(pendingAccountLinkKey),
      authStateStorage.removeItem(pendingPasswordRecoveryKey)
    ]).catch(() => undefined);

    return { ok: true, message: "Signed in. Written reviews are enabled." };
  }

  async function signInWithApple(): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(() => signInWithSocialProvider("Apple", requestAppleCredential));
  }

  async function signInWithGoogle(): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(() => signInWithSocialProvider("Google", requestGoogleCredential));
  }

  async function signInWithSocialProvider(
    providerLabel: "Apple" | "Google",
    requestCredential: () => Promise<SocialProviderCredential>
  ): Promise<AuthActionResult> {
    if (!supabase) {
      return { ok: false, message: missingSupabaseMessage };
    }

    await sessionInitialization.promise;

    if (sessionErrorRef.current) {
      return { ok: false, message: sessionErrorRef.current };
    }

    const pendingDeletionMessage = await getPendingDeletionBlockMessage();

    if (pendingDeletionMessage) {
      return { ok: false, message: pendingDeletionMessage };
    }

    try {
      const initialSession = sessionRef.current ?? await loadCurrentSession();
      const unavailableIdentityMessage = await getUnavailableIdentityMessage(initialSession);

      if (unavailableIdentityMessage) {
        return { ok: false, message: unavailableIdentityMessage };
      }

      if (initialSession && !initialSession.user.is_anonymous) {
        return { ok: false, message: "This device is already signed in to an account." };
      }

      if (initialSession?.user.is_anonymous && hasPendingEmailUpgrade(initialSession.user)) {
        return { ok: false, message: "Finish or remove the pending email account setup before using social sign-in." };
      }

      const credential = await requestCredential();
      const latestSession = sessionRef.current ?? await loadCurrentSession();

      if (initialSession) {
        if (!latestSession || latestSession.user.id !== initialSession.user.id || !latestSession.user.is_anonymous) {
          if (credential.provider === "google") {
            await clearGoogleLocalSession();
          }

          return { ok: false, message: "The private session changed while sign-in was open. It was not replaced; check the current identity before trying again." };
        }
      } else if (latestSession) {
        if (credential.provider === "google") {
          await clearGoogleLocalSession();
        }

        return { ok: false, message: "A private session was created while sign-in was open. It was preserved; review the current identity and try again." };
      }

      const currentSession = latestSession;
      const expectedUserId = initialSession?.user.id ?? null;
      let result;

      if (currentSession) {
        result = await supabase.auth.linkIdentity({
          access_token: credential.accessToken,
          nonce: credential.nonce,
          provider: credential.provider,
          token: credential.token
        });
      } else {
        result = await supabase.auth.signInWithIdToken({
          access_token: credential.accessToken,
          nonce: credential.nonce,
          provider: credential.provider,
          token: credential.token
        });
      }

      if (result.error || !result.data.user || !result.data.session) {
        if (currentSession) {
          const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
          const refreshedSession = refreshedData.session;
          const refreshedUser = refreshedData.user;

          if (!refreshError
            && refreshedUser?.id === expectedUserId
            && !refreshedUser.is_anonymous
            && getAccountProviders(refreshedUser).includes(credential.provider)
            && refreshedSession) {
            sessionRef.current = refreshedSession;
            setSession(refreshedSession);
            return { ok: true, message: `${providerLabel} account linked. Existing contributions were preserved.` };
          }
        }

        if (credential.provider === "google") {
          await clearGoogleLocalSession();
        }

        return {
          ok: false,
          message: currentSession && result.error?.code === "identity_already_exists"
            ? `This ${providerLabel} account already belongs to another Riento identity. Delete this private session only if you intentionally want to sign in to that existing account.`
            : result.error?.message ?? `${providerLabel} sign-in could not be completed.`
        };
      }

      if ((expectedUserId && result.data.user.id !== expectedUserId) || result.data.user.is_anonymous) {
        if (currentSession) {
          const restored = await supabase.auth.setSession({
            access_token: currentSession.access_token,
            refresh_token: currentSession.refresh_token
          });

          if (!restored.error && restored.data.session) {
            sessionRef.current = restored.data.session;
            setSession(restored.data.session);
          }
        }

        return { ok: false, message: "Riento could not safely verify the linked account identity. The original private session was preserved." };
      }

      sessionRef.current = result.data.session;
      setSession(result.data.session);
      await Promise.all([
        authStateStorage.removeItem(pendingAccountLinkKey),
        authStateStorage.removeItem(pendingPasswordRecoveryKey)
      ]).catch(() => undefined);

      return {
        ok: true,
        message: expectedUserId
          ? `${providerLabel} account linked. Existing contributions were preserved.`
          : `Signed in with ${providerLabel}. Written reviews are enabled.`
      };
    } catch (error) {
      return {
        ok: false,
        message: isSocialAuthCancellation(error)
          ? `${providerLabel} sign-in was cancelled.`
          : error instanceof Error ? error.message : `${providerLabel} sign-in could not be completed.`
      };
    }
  }

  async function sendPasswordReset(email: string): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(() => sendPasswordResetUnlocked(email));
  }

  async function sendPasswordResetUnlocked(email: string): Promise<AuthActionResult> {
    if (!supabase) {
      return { ok: false, message: missingSupabaseMessage };
    }

    if (sessionErrorRef.current) {
      return { ok: false, message: sessionErrorRef.current };
    }

    const pendingDeletionMessage = await getPendingDeletionBlockMessage();

    if (pendingDeletionMessage) {
      return { ok: false, message: pendingDeletionMessage };
    }

    const normalizedEmail = email.trim().toLowerCase();
    let currentSession: Session | null;

    try {
      currentSession = sessionRef.current ?? await loadCurrentSession();
    } catch {
      return { ok: false, message: "Could not verify the current device session. Restart Riento before requesting recovery." };
    }

    const unavailableIdentityMessage = await getUnavailableIdentityMessage(currentSession);

    if (unavailableIdentityMessage) {
      return { ok: false, message: unavailableIdentityMessage };
    }

    if (currentSession?.user.is_anonymous) {
      return { ok: false, message: "Delete or upgrade this private device session before recovering a different account." };
    }

    if (!normalizedEmail.includes("@")) {
      return { ok: false, message: "Enter the account email first." };
    }

    await authStateStorage.removeItem(pendingAccountLinkKey);
    await authStateStorage.setItem(pendingPasswordRecoveryKey, normalizedEmail);
    let resetResult;

    try {
      resetResult = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: Linking.createURL("profile")
      });
    } catch (error) {
      await authStateStorage.removeItem(pendingPasswordRecoveryKey).catch(() => undefined);
      throw error;
    }

    const { error } = resetResult;

    if (error) {
      await authStateStorage.removeItem(pendingPasswordRecoveryKey).catch(() => undefined);
    }

    return error ? { ok: false, message: error.message } : { ok: true, message: "Password reset email sent." };
  }

  async function completePasswordRecovery(password: string): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(() => completePasswordRecoveryUnlocked(password));
  }

  async function completePasswordRecoveryUnlocked(password: string): Promise<AuthActionResult> {
    const result = await updateAccountPasswordUnlocked(password);

    if (result.ok) {
      setIsPasswordRecovery(false);
    }

    return result;
  }

  async function updateAccountPassword(password: string): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(() => updateAccountPasswordUnlocked(password));
  }

  async function updateAccountPasswordUnlocked(password: string): Promise<AuthActionResult> {
    if (!supabase) {
      return { ok: false, message: missingSupabaseMessage };
    }

    if (sessionErrorRef.current) {
      return { ok: false, message: sessionErrorRef.current };
    }

    const pendingDeletionMessage = await getPendingDeletionBlockMessage();

    if (pendingDeletionMessage) {
      return { ok: false, message: pendingDeletionMessage };
    }

    if (password.length < 8) {
      return { ok: false, message: "Use a password with at least 8 characters." };
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "Password updated." };
  }

  async function signOut(): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(signOutUnlocked);
  }

  async function signOutUnlocked(): Promise<AuthActionResult> {
    if (!supabase) {
      return { ok: false, message: missingSupabaseMessage };
    }

    const pendingDeletionMessage = await getPendingDeletionBlockMessage();

    if (pendingDeletionMessage) {
      return { ok: false, message: pendingDeletionMessage };
    }

    const hadGoogleIdentity = getAccountProviders(sessionRef.current?.user).includes("google");
    const { error } = await signOutLocalSession();

    if (error) {
      return { ok: false, message: error.message };
    }

    try {
      await clearAuthIdentityMarker();
      if (hadGoogleIdentity) {
        await clearGoogleLocalSession();
      }
    } catch {
      return { ok: false, message: "Signed out, but the saved identity state could not be cleared. Reinstall Riento before using another account." };
    }

    return { ok: true, message: "Signed out. Browsing and device contributions remain available." };
  }

  async function finalizeDeviceDataDeletion(): Promise<AuthActionResult> {
    const pending = await getPendingDeviceDataDeletion();

    if (!pending) {
      return { ok: false, message: "No completed deletion is waiting for local cleanup." };
    }

    let googleRevocationStatus = pending.googleRevocationStatus;

    if (googleRevocationStatus === "pending") {
      try {
        if (!pending.googleSubject) {
          throw new Error("The deleted Google identity could not be verified locally.");
        }

        await revokeGoogleAccess(pending.googleSubject);
        googleRevocationStatus = "succeeded";
      } catch {
        googleRevocationStatus = "failed";
      } finally {
        await clearGoogleLocalSession();
      }

      try {
        await updatePendingGoogleRevocationStatus(googleRevocationStatus);
      } catch {
        return { ok: false, message: "Riento data was deleted, but local provider cleanup could not be recorded. Restart Riento to finish cleanup safely." };
      }
    }

    const { error: signOutError } = await signOutLocalSession();

    if (signOutError) {
      return { ok: false, message: "Riento data was deleted, but the local session could not be cleared. Restart Riento to finish cleanup safely." };
    }

    try {
      await clearAuthIdentityMarker();
      await clearPendingDeletionLocalData(pending);
      await clearPendingDeviceDataDeletion();
    } catch {
      return { ok: false, message: "Riento data was deleted, but local data cleanup is incomplete. Restart Riento to finish cleanup safely." };
    }

    sessionInitializationFailedRef.current = false;
    sessionErrorRef.current = null;
    sessionRef.current = null;
    setSession(null);
    setSessionError(null);
    const warnings = [
      pending.providerRevocation === "failed" ? "Remove Riento in Apple ID settings." : null,
      googleRevocationStatus === "failed" ? "Remove Riento access from your Google Account." : null
    ].filter((warning): warning is string => Boolean(warning));
    const message = pending.requireAnonymous
      ? pending.clearLocalData
        ? "Riento contribution data, local preferences, and the private device session were deleted."
        : "The private session and its server contributions were deleted. My spots and preferences remain."
      : "The Riento account, its attributable data, and local preferences were deleted.";

    return { ok: true, message: `${message}${warnings.length ? ` ${warnings.join(" ")}` : ""}` };
  }

  async function resetUnverifiedIdentity(): Promise<AuthActionResult> {
    return runExclusiveAuthOperation(resetUnverifiedIdentityUnlocked);
  }

  async function verifyNoUnavailableIdentity(): Promise<AuthActionResult> {
    const message = await getUnavailableIdentityMessage(sessionRef.current);
    return message
      ? { ok: false, message }
      : { ok: true, message: "No unavailable saved identity is present." };
  }

  async function resetUnverifiedIdentityUnlocked(): Promise<AuthActionResult> {
    if (!sessionErrorRef.current || sessionRef.current) {
      return { ok: false, message: "There is no unavailable saved session to reset." };
    }

    if (!supabase) {
      return { ok: false, message: missingSupabaseMessage };
    }

    try {
      if (await getPendingDeviceDataDeletion()) {
        return { ok: false, message: "A recoverable deletion is still pending. Restart Riento to resume it instead of discarding the recovery key." };
      }
    } catch {
      await clearPendingDeviceDataDeletion();
    }

    try {
      const { error } = await signOutLocalSession();

      if (error) {
        return { ok: false, message: `The unavailable session could not be removed: ${error.message}` };
      }

      await clearAuthIdentityMarker();
    } catch {
      return { ok: false, message: "The unavailable saved session could not be reset on this device." };
    }

    sessionInitializationFailedRef.current = false;
    sessionErrorRef.current = null;
    setSessionError(null);
    return { ok: true, message: "The unavailable session was reset on this device. Any inaccessible server data was not deleted." };
  }

  const ensureDeviceSession = useCallback(async (): Promise<DeviceSessionResult> => {
    await sessionInitialization.promise;
    const requestedAtGeneration = authMutationGenerationRef.current;

    try {
      if (await getPendingDeviceDataDeletion()) {
        return { ok: false, message: "Account deletion is still being finalized. Retry from Settings or restart Riento before creating another private session.", user: null };
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "The saved deletion recovery state could not be verified.",
        user: null
      };
    }

    if (sessionErrorRef.current) {
      return { ok: false, message: sessionErrorRef.current, user: null };
    }

    if (sessionRef.current?.user) {
      return { ok: true, message: "Private device session ready.", user: sessionRef.current.user };
    }

    if (!supabase) {
      return { ok: false, message: missingSupabaseMessage, user: null };
    }

    const client = supabase;

    if (pendingDeviceSession.current) {
      return pendingDeviceSession.current;
    }

    pendingDeviceSession.current = runExclusiveAuthOperation(async () => {
      if (authMutationGenerationRef.current !== requestedAtGeneration) {
        return {
          ok: false,
          message: "The private identity changed while this contribution was waiting. Try the action again if you still want to continue.",
          user: null
        } as const;
      }

      try {
        if (await getPendingDeviceDataDeletion()) {
          return {
            ok: false,
            message: "Account deletion is still being finalized. Retry from Settings before creating another private session.",
            user: null
          } as const;
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "The saved deletion recovery state could not be verified.",
          user: null
        } as const;
      }

      if (sessionErrorRef.current) {
        return { ok: false, message: sessionErrorRef.current, user: null } as const;
      }

      if (sessionRef.current?.user) {
        return { ok: true, message: "Private device session ready.", user: sessionRef.current.user } as const;
      }

      const { data: currentSessionData, error: currentSessionError } = await client.auth.getSession();

      if (currentSessionError) {
        throw currentSessionError;
      }

      if (currentSessionData.session?.user) {
        sessionRef.current = currentSessionData.session;
        setSession(currentSessionData.session);
        return { ok: true, message: "Private device session ready.", user: currentSessionData.session.user } as const;
      }

      const unavailableIdentityMessage = await getUnavailableIdentityMessage(null);

      if (unavailableIdentityMessage) {
        return { ok: false, message: unavailableIdentityMessage, user: null } as const;
      }

      const { data, error } = await client.auth.signInAnonymously();

      if (error || !data.session?.user) {
        return {
          ok: false,
          message: error?.message ?? "Could not prepare this device for contributions.",
          user: null
        } as const;
      }

      setSession(data.session);
      sessionRef.current = data.session;
      return { ok: true, message: "Private device session created.", user: data.session.user } as const;
    }).catch((error: unknown) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : "Could not prepare this device for contributions.",
      user: null
    })).finally(() => {
      pendingDeviceSession.current = null;
    });

    return pendingDeviceSession.current;
  }, [sessionInitialization]);

  return (
    <AuthContext.Provider
      value={{
        accountProviders,
        authCallbackMessage,
        completePasswordRecovery,
        createAccount,
        ensureDeviceSession,
        finalizeDeviceDataDeletion,
        isAdmin: Boolean(session?.user && !session.user.is_anonymous && adminUserId === session.user.id),
        isAnonymous: Boolean(session?.user?.is_anonymous),
        isAuthBusy,
        isConfigured: isSupabaseConfigured,
        isLoading,
        isPasswordRecovery,
        refreshAdminStatus,
        resetUnverifiedIdentity,
        runExclusiveAuthOperation,
        sendPasswordReset,
        session,
        sessionError,
        signIn,
        signInWithApple,
        signInWithGoogle,
        signOut,
        updateAccountPassword,
        user: session?.user ?? null,
        verifyNoUnavailableIdentity
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function isValidAccountInput(email: string, password: string) {
  return isValidEmail(email) && password.length > 0;
}

async function getPendingDeletionBlockMessage() {
  try {
    return await getPendingDeviceDataDeletion()
      ? "Account deletion is still being finalized. Retry it from Data controls before changing accounts."
      : null;
  } catch (error) {
    return error instanceof Error ? error.message : "The saved deletion recovery state could not be verified.";
  }
}

async function loadCurrentSession() {
  if (!supabase) {
    throw new Error(missingSupabaseMessage);
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

function isValidEmail(email: string) {
  return email.includes("@") && email.includes(".");
}

function hasPendingEmailUpgrade(user: User) {
  return Boolean(user.email || user.new_email);
}

function getAccountProviders(user: User | null | undefined): AccountProvider[] {
  const providers = new Set<AccountProvider>();

  for (const identity of user?.identities ?? []) {
    if (identity.provider === "apple" || identity.provider === "email" || identity.provider === "google") {
      providers.add(identity.provider);
    }
  }

  const metadataProviders = Array.isArray(user?.app_metadata.providers) ? user.app_metadata.providers : [];

  for (const provider of metadataProviders) {
    if (provider === "apple" || provider === "email" || provider === "google") {
      providers.add(provider);
    }
  }

  return [...providers];
}

function getProviderSubject(user: User | null | undefined, provider: string) {
  const identity = user?.identities?.find((candidate) => candidate.provider === provider);
  const subject = identity?.identity_data?.sub;
  return typeof subject === "string" ? subject : identity?.id ?? null;
}

function getQueryParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isExpectedAuthCallback(actual: ReturnType<typeof Linking.parse>, expected: ReturnType<typeof Linking.parse>) {
  const normalizePath = (value: string | null | undefined) => value?.replace(/^\/+|\/+$/g, "") ?? "";
  const getTarget = (value: ReturnType<typeof Linking.parse>) => [value.hostname, normalizePath(value.path)].filter(Boolean).join("/");

  return actual.scheme === expected.scheme
    && getTarget(actual) === getTarget(expected);
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return value;
}
