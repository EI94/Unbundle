import type { NextRequest } from "next/server";
import { learningRequestOrigin, LearningHttpError } from "@/lib/learning/http";
import { readLearningAdminRequest } from "@/lib/learning/admin-http";
import { performLearningAdmin } from "@/lib/learning/admin";
import { LearningError } from "@/lib/learning/server";

export const runtime="nodejs";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const statuses:Record<string,number>={unauthenticated:401,forbidden:403,invalid:422,conflict:409,closed:409,unavailable:503,technical:503};
export async function POST(request:NextRequest) {
  try{
    const input=await readLearningAdminRequest(request,learningRequestOrigin(request,request.nextUrl.protocol));
    return Response.json({ok:true,data:await performLearningAdmin(input)},{status:200,headers});
  }catch(error){
    if(error instanceof LearningHttpError)return Response.json({ok:false,code:error.status===403?"forbidden":"invalid",message:error.message},{status:error.status,headers});
    if(error instanceof LearningError)return Response.json({ok:false,code:error.code,message:error.message},{status:statuses[error.code]??503,headers});
    // Never serialize parser/database exceptions or log private pack parameters.
    return Response.json({ok:false,code:"technical",message:"Operazione non confermata. Aggiorna lo stato del corso prima di riprovare."},{status:503,headers});
  }
}
