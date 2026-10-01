"use client";
import type { AdminResponseMap, LearningAdminRequest, LearningAdminResult } from "./admin-contract";

export async function learningAdminRequest<R extends LearningAdminRequest>(request: R): Promise<LearningAdminResult<AdminResponseMap[R["operation"]]>> {
  const response = await fetch("/api/learning/admin", {method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",
    headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(request)});
  if (response.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json") throw new Error("Risposta del server non valida. L’operazione non è confermata.");
  const body:unknown=await response.json();
  if (body && typeof body==="object" && "ok" in body) {
    if(body.ok===true && response.ok && "data" in body)return body as LearningAdminResult<AdminResponseMap[R["operation"]]>;
    if(body.ok===false && "code" in body && typeof body.code==="string" && "message" in body && typeof body.message==="string")return body as LearningAdminResult<AdminResponseMap[R["operation"]]>;
  }
  throw new Error("Risposta del server non valida. L’operazione non è confermata.");
}
