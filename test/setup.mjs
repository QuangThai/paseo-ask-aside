// Lets `node --test` load the plugin's TypeScript sources, which import siblings without
// extensions the way the Paseo bundler resolves them.
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);
