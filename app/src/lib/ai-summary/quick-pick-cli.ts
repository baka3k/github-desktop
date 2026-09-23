/** Curated list of external CLI tools which can generate commit messages. */

export interface IQuickPickCLI {
  readonly id: string
  readonly displayName: string
  readonly executable: string
  readonly extraArgs: ReadonlyArray<string>
  readonly apiKeyEnvVar: string | null
  readonly installHint: string
}

export const QuickPickCLI: ReadonlyArray<IQuickPickCLI> = [
  {
    id: 'claudecode',
    displayName: 'Claude Code',
    executable: 'claudecode',
    extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    installHint: 'npm i -g @anthropic-ai/claude-code',
  },
  {
    id: 'mcode',
    displayName: 'Mcode (local)',
    executable: 'mcode',
    extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: null,
    installHint: 'npm i -g @baka3k/mcode',
  },
  {
    id: 'qwen',
    displayName: 'Qwen CLI',
    executable: 'qwen',
    extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    installHint: 'pip install qwen-cli',
  },
  {
    id: 'opencode',
    displayName: 'Opencode',
    executable: 'opencode',
    extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: null,
    installHint: 'npm i -g opencode',
  },
  {
    id: 'commandcode',
    displayName: 'Commandcode',
    executable: 'commandcode',
    extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: null,
    installHint: 'npm i -g commandcode',
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    executable: 'gemini',
    extraArgs: ['--mode', 'commit-summary'],
    apiKeyEnvVar: 'GEMINI_API_KEY',
    installHint: 'npm i -g @google/gemini-cli',
  },
]
