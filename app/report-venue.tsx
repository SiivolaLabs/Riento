import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Screen } from "../src/components/Screen";
import { useAuth } from "../src/context/AuthContext";
import { submitMissingVenueReport } from "../src/services/venueService";
import { colors } from "../src/theme/colors";

export default function ReportVenueScreen() {
  const { query } = useLocalSearchParams<{ query?: string }>();
  const router = useRouter();
  const { ensureDeviceSession } = useAuth();
  const [details, setDetails] = useState(typeof query === "string" ? `Search: ${query}\n` : "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canSubmit = details.trim().length >= 5 && !isSubmitting;

  async function handleSubmit() {
    setMessage(null);

    if (!canSubmit) {
      setMessage("Add a venue name, address, or area before sending.");
      return;
    }

    try {
      setIsSubmitting(true);
      const deviceSession = await ensureDeviceSession();

      if (!deviceSession.ok) {
        setMessage(deviceSession.message);
        return;
      }

      const result = await submitMissingVenueReport(details);
      setMessage(result.message);

      if (result.ok) {
        setDetails("");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>

        <Text style={styles.kicker}>Venue coverage</Text>
        <Text style={styles.title}>Report a missing place.</Text>
        <Text style={styles.subtitle}>Send the venue name, address, neighborhood, or any details that help verify it. Reports are private review inputs.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Missing venue details</Text>
          <Text style={styles.cardText}>Reports use a random private app session for cooldowns and stay private for operator review. No public profile is created.</Text>
          <TextInput
          multiline
          maxLength={1000}
            onChangeText={setDetails}
            placeholder="Example: Venue name, street, neighborhood, and what kind of place it is"
            placeholderTextColor={colors.muted}
            style={styles.input}
            textAlignVertical="top"
            value={details}
          />
          <Pressable disabled={!canSubmit} onPress={handleSubmit} style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}>
            <Text style={styles.primaryButtonText}>{isSubmitting ? "Sending..." : "Send missing venue"}</Text>
          </Pressable>
          {message && <Text style={styles.messageText}>{message}</Text>}
        </View>

        <View style={styles.trustCard}>
          <Text style={styles.cardTitle}>What happens next</Text>
          <Text style={styles.cardText}>Riento stores this as a private missing-venue report in the operator review queue. We verify venue status, coordinates, opening hours, and category before adding it to public venue data.</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  backButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    marginTop: 24,
    padding: 18
  },
  cardText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  content: {
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 18
  },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 150,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.8,
    marginTop: 22,
    textTransform: "uppercase"
  },
  messageText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: 999,
    paddingVertical: 14
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12
  },
  title: {
    color: colors.text,
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: -1.2,
    lineHeight: 43,
    marginTop: 8
  },
  trustCard: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    marginTop: 16,
    padding: 18
  }
});
