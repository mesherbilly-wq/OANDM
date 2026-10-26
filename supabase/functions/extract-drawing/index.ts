import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleAiExtract } from "../_shared/aiExtract.ts";

Deno.serve(handleAiExtract);
