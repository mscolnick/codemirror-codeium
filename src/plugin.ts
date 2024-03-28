import { EditorView } from "@codemirror/view";
import { Extension, Prec } from "@codemirror/state";
import { completionDecoration } from "./completionDecoration.js";
import { completionRequester } from "./completionRequester.js";
import { sameKeyCommand, rejectSuggestionCommand } from "./commands.js";
import { CodeiumConfig, codeiumConfig } from "./config.js";
import { Language } from "./api/proto/exa/codeium_common_pb/codeium_common_pb.js";

function completionPlugin() {
  return EditorView.domEventHandlers({
    keydown(event, view) {
      if (
        event.key !== "Shift" &&
        event.key !== "Control" &&
        event.key !== "Alt" &&
        event.key !== "Meta"
      ) {
        return sameKeyCommand(view, event.key);
      } else {
        return false;
      }
    },
    mousedown(_event, view) {
      return rejectSuggestionCommand(view);
    },
  });
}

function viewCompletionPlugin() {
  return EditorView.updateListener.of((update) => {
    if (update.focusChanged) {
      rejectSuggestionCommand(update.view);
    }
  });
}

export { Language };

export function copilotPlugin(config: CodeiumConfig): Extension {
  return [
    codeiumConfig.of(config),
    completionDecoration,
    Prec.highest(completionPlugin()),
    Prec.highest(viewCompletionPlugin()),
    completionRequester(),
  ];
}
