import { completionStatus } from "@codemirror/autocomplete";
import { ChangeSet, Transaction } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { getCodeiumCompletions } from "./codeium.js";
import {
  acceptSuggestion,
  addSuggestions,
  clearSuggestion,
} from "./effects.js";
import { completionDecoration } from "./completionDecoration.js";
import { copilotEvent } from "./annotations.js";

// milliseconds before cancelling request
// against codeium
const TIMEOUT = 150;

/**
 * To request a completion, the document needs to have been
 * updated and the update should not have been because
 * of accepting or clearing a suggestion.
 */
function shouldRequestCompletion(update: ViewUpdate) {
  return (
    update.docChanged &&
    !update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(acceptSuggestion) || e.is(clearSuggestion)),
    )
  );
}

/**
 * Don't request a completion if we've already
 * done so, or it's a copilot event we're responding
 * to, or if the view is not focused.
 */
function shouldIgnoreUpdate(update: ViewUpdate) {
  // not focused
  if (!update.view.hasFocus) return true;

  // contains ghost text
  if (update.state.field(completionDecoration).ghostTexts != null) return true;

  // is autocompleting
  if (completionStatus(update.state) === "active") return true;

  // bad update
  for (const tr of update.transactions) {
    if (tr.annotation(copilotEvent) !== undefined) {
      return true;
    }
  }
}

/**
 * A view plugin that requests completions from the server after a delay
 */
export function completionRequester() {
  let timeout: any = null;
  let lastPos = 0;

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!shouldRequestCompletion(update)) return;

    // Cancel the previous timeout
    if (timeout) {
      clearTimeout(timeout);
    }

    if (shouldIgnoreUpdate(update)) {
      return;
    }

    // Get the current position and source
    const state = update.state;
    const pos = state.selection.main.head;
    const source = state.doc.toString();

    // Set a new timeout to request completion
    timeout = setTimeout(async () => {
      // Check if the position has changed
      if (pos !== lastPos) return;

      // Request completion from the server
      try {
        const completionResult = await getCodeiumCompletions({
          text: source,
          cursorOffset: pos,
        });

        if (!completionResult || completionResult.length === 0) {
          return;
        }

        // Check if the position is still the same. If
        // it has changed, ignore the code that we just
        // got from the API and don't show anything.
        if (
          !(
            pos === lastPos &&
            completionStatus(update.view.state) !== "active" &&
            update.view.hasFocus
          )
        ) {
          return;
        }

        // Dispatch an effect to add the suggestion
        // If the completion starts before the end of the line,
        // check the end of the line with the end of the completion
        const insertChangeSet = ChangeSet.of(
          completionResult.map((part) => ({
            from: Number(part.offset),
            to: Number(part.offset),
            insert: part.text,
          })),
          state.doc.length,
        );

        const reverseChangeSet = insertChangeSet.invert(state.doc);

        update.view.dispatch({
          changes: insertChangeSet,
          effects: addSuggestions.of({
            reverseChangeSet,
            suggestions: completionResult.map((part) => ({
              displayText: part.text,
              endReplacement: 0, // "",
              text: part.text,
              cursorPos: pos,
              startPos: Number(part.offset),
              endPos: Number(part.offset) + part.text.length,
            })),
          }),
          annotations: [
            copilotEvent.of(null),
            Transaction.addToHistory.of(false),
          ],
        });
      } catch (error) {
        console.warn("copilot completion failed", error);
        // Javascript wait for 500ms for some reason is necessary here.
        // TODO - FIGURE OUT WHY THIS RESOLVES THE BUG

        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }, TIMEOUT);
    // Update the last position
    lastPos = pos;
  });
}
