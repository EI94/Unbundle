"use server";
import { z } from "zod";
import * as learning from "@/lib/learning/server";
import type { AttemptDTO, LearningErrorCode } from "@/lib/learning/server";
export type LearningActionResult<T = AttemptDTO> = {ok:true;data:T} | {ok:false;code:LearningErrorCode;message:string;fieldErrors?:Record<string,string>};
const scope={workspaceId:z.uuid(),programId:z.uuid()};
const revision=z.number().int().min(1).max(2_147_483_646);
async function run<T>(fn:()=>Promise<T>):Promise<LearningActionResult<T>> {
  try { return {ok:true,data:await fn()}; }
  catch(error) {
    if(error instanceof learning.LearningError) return {ok:false,code:error.code,message:error.message,fieldErrors:error.fieldErrors};
    if(error instanceof z.ZodError) return {ok:false,code:"invalid",message:"Richiesta non valida. Ricarica e controlla i campi."};
    // Never log answers, private pack, database error details or credentials.
    console.error("learning_request_failed");
    return {ok:false,code:"technical",message:"Il server non ha confermato l'operazione. Conserva questa pagina e riprova; le modifiche non confermate non sono salvate."};
  }
}
export async function startLearningAttempt(input:unknown) {
  return run(()=>learning.startLearningAttempt(z.object({...scope,activityId:z.string().max(100),expectedVersion:z.string().max(100)}).strict().parse(input)));
}
export async function saveLearningDraft(input:unknown) {
  return run(()=>learning.saveLearningDraft(z.object({...scope,attemptId:z.uuid(),expectedRevision:revision,responses:z.unknown()}).strict().parse(input) as Parameters<typeof learning.saveLearningDraft>[0]));
}
export async function submitLearningAttempt(input:unknown) {
  return run(()=>learning.submitLearningAttempt(z.object({...scope,attemptId:z.uuid(),expectedRevision:revision,idempotencyKey:z.uuid()}).strict().parse(input)));
}
export async function startLearningRetake(input:unknown) {
  return run(()=>learning.startLearningRetake(z.object({...scope,parentAttemptId:z.uuid()}).strict().parse(input)));
}
export async function exportLearningCsv(input:unknown) {
  return run(()=>{const parsed=z.object(scope).strict().parse(input);return learning.exportLearningCsv(parsed.workspaceId,parsed.programId);});
}
export async function submitLearningDecisions(input:unknown) {
  return run(()=>learning.submitLearningDecisions(z.object({...scope,attemptId:z.uuid(),expectedRevision:revision}).strict().parse(input)));
}
