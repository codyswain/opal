import { createLowlight } from "lowlight";
import js from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import css from "highlight.js/lib/languages/css";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

export function configureLowlight() {
  const lowlight = createLowlight();
  lowlight.register("js", js);
  lowlight.register("python", python);
  lowlight.register("css", css);
  lowlight.register('typescript', js);
  lowlight.register('html', js);
  lowlight.register('json', js);
  lowlight.register('markdown', js);
  lowlight.register('sql', js);
  lowlight.register('bash', js);
  
  return lowlight;
}