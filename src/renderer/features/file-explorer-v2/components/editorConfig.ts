import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import html from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";

export function configureLowlight() {
  const lowlight = createLowlight();
  
  // Register languages
  lowlight.register('js', javascript);
  lowlight.register('javascript', javascript);
  lowlight.register('typescript', typescript);
  lowlight.register('ts', typescript);
  lowlight.register('python', python);
  lowlight.register('py', python);
  lowlight.register('html', html);
  lowlight.register('css', css);
  lowlight.register('json', json);
  lowlight.register('markdown', markdown);
  lowlight.register('md', markdown);
  lowlight.register('sql', sql);
  lowlight.register('bash', bash);
  lowlight.register('sh', bash);
  
  return lowlight;
}