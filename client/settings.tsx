import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { ANSWER_WITH_CHOICES, MODEL_CHOICES, preferences } from "../shared/contracts";

const ANSWER_WITH_LABELS: Record<(typeof ANSWER_WITH_CHOICES)[number], string> = {
  agent: "The agent's own provider",
  claude: "Always Claude (no tools)",
};

const MODEL_LABELS: Record<(typeof MODEL_CHOICES)[number], string> = {
  same: "Same as the agent",
  haiku: "Latest Haiku",
  sonnet: "Latest Sonnet",
  opus: "Latest Opus",
};

export function AsideSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const [claudeCommand, setClaudeCommand] = useState<string | null>(null);
  const [codexCommand, setCodexCommand] = useState<string | null>(null);

  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Ask Aside">
        <SettingsCard>
          <SettingsRow label="Settings could not be read" error={settings.error}>
            <Text style={{ color: theme.colors.foregroundMuted }}>Reset to restore the defaults.</Text>
          </SettingsRow>
          <SettingsAction label="Reset settings" actionLabel="Reset" onPress={() => void settings.reset()} />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const values = settings.values;
  const draftClaude = (claudeCommand ?? values.claudeCommand).trim();
  const draftCodex = (codexCommand ?? values.codexCommand).trim();
  const commandsChanged =
    (draftClaude !== values.claudeCommand || draftCodex !== values.codexCommand) && !!draftClaude && !!draftCodex;

  return (
    <SettingsSection title="Ask Aside">
      <SettingsCard>
        <SettingsSelect
          label="Answer with"
          hint="The agent's own provider answers Codex agents with Codex in a read-only sandbox, where it can read files but not change them, and every other agent with Claude without tools. Always Claude never gives the answering model any tools."
          value={values.answerWith}
          options={ANSWER_WITH_CHOICES.map((value) => ({ value, label: ANSWER_WITH_LABELS[value] }))}
          disabled={settings.saving}
          onValueChange={(answerWith) => void settings.save({ ...values, answerWith }, settings.revision)}
        />
        <SettingsSelect
          label="Claude model"
          hint="Used whenever Claude answers. Same as the agent uses a Claude agent's own model, and Sonnet for other providers."
          value={values.model}
          options={MODEL_CHOICES.map((value) => ({ value, label: MODEL_LABELS[value] }))}
          disabled={settings.saving}
          onValueChange={(model) => void settings.save({ ...values, model }, settings.revision)}
        />
      </SettingsCard>
      <SettingsCard>
        <SettingsInput
          label="Claude Code command"
          hint="Command or full path on the daemon host. Leave as claude when it is on the daemon's PATH."
          initialValue={values.claudeCommand}
          placeholder="claude"
          onChangeText={setClaudeCommand}
        />
        <SettingsInput
          label="Codex command"
          hint="Command or full path on the daemon host. Leave as codex when it is on the daemon's PATH."
          initialValue={values.codexCommand}
          placeholder="codex"
          onChangeText={setCodexCommand}
          error={settings.saveError}
        />
        <SettingsAction
          label="Save commands"
          actionLabel="Save"
          disabled={settings.saving || !commandsChanged}
          onPress={() =>
            void settings.save({ ...values, claudeCommand: draftClaude, codexCommand: draftCodex }, settings.revision)
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
