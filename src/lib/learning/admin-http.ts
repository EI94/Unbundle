import { LearningHttpError } from "./http.ts";
import { learningAdminRequestSchema } from "./admin-contract.ts";

export const LEARNING_ADMIN_MAX_BYTES=5_000_000;
/** The byte cap applies to the entire JSON envelope, before parsing private input. */
export async function readLearningAdminRequest(request:Request,expectedOrigin:string) {
  if(request.headers.get("origin")!==expectedOrigin)throw new LearningHttpError(403,"Origine della richiesta non autorizzata.");
  if(request.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw new LearningHttpError(415,"La richiesta deve contenere JSON.");
  const length=request.headers.get("content-length");
  if(length!==null && (!/^\d+$/.test(length) || Number(length)>LEARNING_ADMIN_MAX_BYTES))throw new LearningHttpError(413,"Il pacchetto supera il limite di 5 MB.");
  if(!request.body)throw new LearningHttpError(400,"Richiesta vuota.");
  const reader=request.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});
  let bytes=0,body="";
  try {
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
      if(bytes>LEARNING_ADMIN_MAX_BYTES){await reader.cancel();throw new LearningHttpError(413,"Il pacchetto supera il limite di 5 MB.");}
      body+=decoder.decode(chunk.value,{stream:true});}
    body+=decoder.decode();
  } catch(error){if(error instanceof LearningHttpError)throw error;throw new LearningHttpError(400,"Corpo della richiesta non valido.");}
  finally{reader.releaseLock();}
  let decoded:unknown;try{decoded=JSON.parse(body);}catch{throw new LearningHttpError(400,"JSON non valido.");}
  const parsed=learningAdminRequestSchema.safeParse(decoded);
  if(!parsed.success)throw new LearningHttpError(422,"Operazione o campi non validi. Controlla i dati richiesti.");
  return parsed.data;
}
