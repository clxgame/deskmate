import { asMemoryError, memoryContext } from "../lib/memory";

/**
 * Compose the system prompt for one turn.
 *
 * The memory block always comes last, after the persona and any language
 * override, so stored facts can only add context to the instructions above
 * them.
 */
export function composeSystemPrompt(options: {
  personaPrompt: string | undefined;
  memoryBlock: string;
  userNameInstruction?: string;
}): string | undefined {
  const persona = options.personaPrompt?.trim();
  const memory = options.memoryBlock.trim();
  const userName = options.userNameInstruction?.trim();
  const sections = [persona, memory, userName].filter(
    (section): section is string =>
      section !== undefined && section.length > 0,
  );
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

/**
 * Fetch the memory block for a turn.
 *
 * Never throws: a memory failure must not stop the message from being sent.
 */
export async function memoryBlockForTurn(options: {
  personaId: string;
  userText: string;
  enabled: boolean;
  directory?: string;
}): Promise<string> {
  if (!options.enabled) return "";
  try {
    const context = await memoryContext(options);
    return context.promptBlock;
  } catch (error) {
    // Content-free: only the stable code reaches the console.
    console.warn("memory context skipped", asMemoryError(error).code);
    return "";
  }
}
