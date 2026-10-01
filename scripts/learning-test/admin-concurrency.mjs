import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run only against an explicitly isolated, already migrated local test database.
// This adapter executes the current production SQL through real PostgreSQL
// transactions. Identity/session providers are synthetic; this is not an HTTP
// authentication test. See admin-concurrency.md for setup and interpretation.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const output=process.env.LEARNING_TEST_OUTPUT;
if(process.env.LEARNING_TEST_ISOLATED!=='true' || !process.env.LEARNING_TEST_DATABASE_URL)
  throw Error('LEARNING_TEST_ISOLATED=true and LEARNING_TEST_DATABASE_URL are required');
let databaseUrl;
try { databaseUrl=new URL(process.env.LEARNING_TEST_DATABASE_URL); }
catch { throw Error('Use an isolated PostgreSQL test URL'); }
if(!['postgres:','postgresql:'].includes(databaseUrl.protocol)
  || !['127.0.0.1','localhost','[::1]'].includes(databaseUrl.hostname)
  || !databaseUrl.pathname.slice(1) || databaseUrl.search || databaseUrl.hash)
  throw Error('Database must use a literal loopback host, database name, and no query overrides');
if(!output || !isAbsolute(output))throw Error('LEARNING_TEST_OUTPUT must be an absolute directory outside this checkout');
await mkdir(output,{recursive:true,mode:0o700});
const outputDirectory=await realpath(output),checkout=await realpath(root);
const outputRelative=relative(checkout,outputDirectory);
if(!outputRelative || (!outputRelative.startsWith(`..${sep}`) && outputRelative!=='..' && !isAbsolute(outputRelative)))
  throw Error('Evidence output must remain outside this checkout');
const require=createRequire(`${root}/package.json`);
const {Client}=require('pg'),ts=require('typescript'),{sql}=require('drizzle-orm'),{PgDialect}=require('drizzle-orm/pg-core');
const clients=[];
async function connect(){
  const c=new Client({host:databaseUrl.hostname.replace(/^\[|\]$/g,''),port:Number(databaseUrl.port||5432),
    user:decodeURIComponent(databaseUrl.username),password:decodeURIComponent(databaseUrl.password),
    database:decodeURIComponent(databaseUrl.pathname.slice(1)),ssl:false,connectionTimeoutMillis:5000});
  await c.connect();clients.push(c);
  await c.query("SET statement_timeout='12s'");
  await c.query("SET idle_in_transaction_session_timeout='15s'");
  return c;
}
let setup,learner,adminA,adminB;
const ids=Object.fromEntries(['org','workspace','manager','learner','program','enrollment'].map(k=>[k,randomUUID()]));
const dialect=new PgDialect();
const compile=query=>dialect.sqlToQuery(query);
const execute=(client,query)=>{const {sql:text,params}=compile(query);return client.query(text,params);};
class LearningError extends Error{constructor(code,message){super(message);this.code=code;}}
const source=await readFile(`${root}/src/lib/learning/admin.ts`,'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function admin(client,afterLock){
 const db={execute(query){return {query,then(resolve,reject){return execute(client,query).then(resolve,reject);}};},async batch(plans){await client.query('BEGIN');try{const values=[];for(let index=0;index<plans.length;index++){values.push(await execute(client,plans[index].query));if(index===0&&afterLock)await afterLock();}await client.query('COMMIT');return values;}catch(error){await client.query('ROLLBACK');throw error;}}};
 const localRequire=name=>{
  if(name==='server-only')return {};
  if(name==='@/lib/db')return {db};
  if(name==='@/lib/auth')return {auth:async()=>({user:{id:ids.manager}})};
  if(name==='@/lib/workspace-access')return {getWorkspaceAccessForUser:async(user,w)=>{const r=await client.query('SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2',[w,user]);return r.rows[0]??null;}};
  if(name==='./server')return {learningEnabled:()=>true,LearningError};
  if(name==='./pack')return {};
  if(name==='./retention')return {};
  return require(name);
 };
 const loaded={exports:{}};new Function('require','exports','module',js)(localRequire,loaded.exports,loaded);return loaded.exports.performLearningAdmin;
}
const learnerSource=await readFile(`${root}/src/lib/learning/server.ts`,'utf8');
const sourceContents=new Map([
 ['src/lib/learning/admin.ts',source],['src/lib/learning/server.ts',learnerSource],
 ['src/lib/learning/admin-contract.ts',await readFile(resolve(root,'src/lib/learning/admin-contract.ts'),'utf8')],
 ['scripts/learning-test/admin-concurrency.mjs',await readFile(fileURLToPath(import.meta.url),'utf8')],
]);
const body=learnerSource.slice(learnerSource.indexOf('export function learningWriteGuard'),learnerSource.indexOf('export async function startLearningAttempt'));
const expression=body.match(/return sql`([\s\S]*?)`;/)?.[1];assert.ok(expression,'actual learning guard source found');
const guard=new Function('sql','ctx','releaseMinutes',`return sql\`${expression}\`;`);
const ctx={program:{id:ids.program,workspaceId:ids.workspace},enrollment:{id:ids.enrollment,cohortId:'a'},userId:ids.learner};
async function start(){return execute(learner,sql`INSERT INTO learning_attempts(id,workspace_id,program_id,enrollment_id,user_id,activity_id,attempt_number,content_version,pack_hash,item_order)
 SELECT ${randomUUID()}::uuid,${ids.workspace}::uuid,${ids.program}::uuid,${ids.enrollment}::uuid,${ids.learner}::uuid,'synthetic-race',1,'race-v1',${'0'.repeat(64)},'{}'::jsonb
 WHERE ${guard(sql,ctx,0)} RETURNING id`);}
const scope={workspaceId:ids.workspace,programId:ids.program};
const move={operation:'enrollment',input:{...scope,enrollmentId:ids.enrollment,status:'active',cohortId:'b'}};
const reopen={operation:'lifecycle',input:{...scope,action:'reopen'}};
const purge={operation:'purge',input:{...scope,confirmProgramId:ids.program,confirmTitle:'Synthetic concurrency'}};
const pending=[];
const settle=p=>{const result=p.then(value=>({value}),error=>({error}));pending.push(result);return result;};
const gates=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);gates.push(resolve);return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected phase did not start within five seconds')),5000);})]);}finally{clearTimeout(timer);}}
async function waitForLock(client){for(let i=0;i<300;i++){const r=await setup.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[client.processID]);if(r.rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected actual PostgreSQL lock wait did not occur');}
async function counts(){return (await setup.query('SELECT (SELECT count(*)::int FROM learning_attempts WHERE program_id=$1) attempts,(SELECT count(*)::int FROM learning_enrollments WHERE program_id=$1) enrollments,(SELECT status FROM learning_programs WHERE id=$1) status,(SELECT cohort_id FROM learning_enrollments WHERE id=$2) cohort',[ids.program,ids.enrollment])).rows[0];}
async function reset(){await setup.query('DELETE FROM learning_attempts WHERE program_id=$1',[ids.program]);await setup.query("UPDATE learning_programs SET status='published',closed_at=NULL WHERE id=$1",[ids.program]);await setup.query("UPDATE learning_enrollments SET cohort_id='a' WHERE id=$1",[ids.enrollment]);}
const results=[];
async function check(name,fn){
  try{await fn();results.push({name,status:'PASS'});console.log(`PASS ${name}`);}
  catch(e){results.push({name,status:'FAIL',errorType:e.name});console.log(`FAIL ${name}`);throw e;}
}
let fixtureCleanup='not-started',failure=null;
try{
 setup=await connect();learner=await connect();adminA=await connect();adminB=await connect();
 fixtureCleanup='pending';
 await setup.query('INSERT INTO organizations(id,name,slug) VALUES ($1,$2,$3)',[ids.org,'Synthetic race',`race-${ids.org}`]);
 await setup.query('INSERT INTO users(id,email) VALUES ($1,$2),($3,$4)',[ids.manager,`manager-${ids.manager}@example.invalid`,ids.learner,`learner-${ids.learner}@example.invalid`]);
 await setup.query('INSERT INTO workspaces(id,organization_id,name) VALUES ($1,$2,$3)',[ids.workspace,ids.org,'Synthetic race']);
 await setup.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'contributor'),($1,$3,'contributor')",[ids.workspace,ids.manager,ids.learner]);
 await setup.query("INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,visibility_policy,retention_days,published_by,feature_enabled) VALUES ($1,$2,'race','Synthetic concurrency','race-v1',$3,'{}','Synthetic only retention policy',1,$4,true)",[ids.program,ids.workspace,'0'.repeat(64),ids.manager]);
 await setup.query("INSERT INTO learning_sessions(workspace_id,program_id,module_id,cohort_id,starts_at,ends_at,status) VALUES ($1,$2,'m1','a',now()-interval '1 hour',now()+interval '1 hour','open'),($1,$2,'m1','b',now()-interval '1 hour',now()+interval '1 hour','open')",[ids.workspace,ids.program]);
 await setup.query("INSERT INTO learning_enrollments(id,workspace_id,program_id,user_id,module_id,cohort_id) VALUES ($1,$2,$3,$4,'m1','a')",[ids.enrollment,ids.workspace,ids.program,ids.learner]);
 await setup.query("INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,granted_by) VALUES ($1,$2,$3,'manage',$3)",[ids.workspace,ids.program,ids.manager]);
 await check('start committed before move: admin waits then denies moving an enrollment with work',async()=>{
  await learner.query('BEGIN');assert.equal((await start()).rowCount,1);
  const moving=settle(admin(adminA)(move));await waitForLock(adminA);await learner.query('COMMIT');
  const result=await moving;assert.equal(result.error?.code,'conflict');assert.deepEqual(await counts(),{attempts:1,enrollments:1,status:'published',cohort:'a'});
 });
 await reset();
 await check('move committed before stale start: learner waits and old cohort guard denies insertion',async()=>{
  const locked=deferred(),release=deferred();const moving=settle(admin(adminA,async()=>{locked.resolve();await release.promise;})(move));await bounded(locked.promise);
  const starting=settle(start());await waitForLock(learner);release.resolve();const mr=await moving,sr=await starting;
  assert.equal(mr.value?.changed,1);assert.equal(sr.error,undefined);assert.equal(sr.value.rowCount,0);assert.deepEqual(await counts(),{attempts:0,enrollments:1,status:'published',cohort:'b'});
 });
 await reset();await start();await setup.query("UPDATE learning_programs SET status='closed',closed_at=now()-interval '2 days' WHERE id=$1",[ids.program]);
 await check('reopen committed before purge: purge waits then fresh eligibility rejects deletion',async()=>{
  const locked=deferred(),release=deferred();const opening=settle(admin(adminA,async()=>{locked.resolve();await release.promise;})(reopen));await bounded(locked.promise);
  const purging=settle(admin(adminB)(purge));await waitForLock(adminB);release.resolve();assert.equal((await opening).value?.changed,1);assert.equal((await purging).error?.code,'conflict');
  assert.deepEqual(await counts(),{attempts:1,enrollments:1,status:'published',cohort:'a'});
 });
 await setup.query("UPDATE learning_programs SET status='closed',closed_at=now()-interval '2 days' WHERE id=$1",[ids.program]);
 await check('eligible purge committed before reopen: one deletion then reopen preserves enrollment',async()=>{
  const locked=deferred(),release=deferred();const purging=settle(admin(adminA,async()=>{locked.resolve();await release.promise;})(purge));await bounded(locked.promise);
  const opening=settle(admin(adminB)(reopen));await waitForLock(adminB);release.resolve();assert.equal((await purging).value?.changed,1);assert.equal((await opening).value?.changed,1);
  assert.deepEqual(await counts(),{attempts:0,enrollments:1,status:'published',cohort:'a'});
 });
}catch(error){
 failure=error.name;process.exitCode=1;
 console.error('Concurrency test did not complete. Review PASS/FAIL and unrun count in the sanitized receipt.');
}finally{
 for(const release of gates)release();
 if(learner)await learner.query('ROLLBACK').catch(()=>{});
 await Promise.allSettled(pending);
 for(const c of [learner,adminA,adminB])if(c)await c.query('ROLLBACK').catch(()=>{});
 try{
  if(setup && fixtureCleanup==='pending'){
   // Every deletion uses random IDs created by this invocation only.
   for(const table of ['learning_idea_drafts','learning_attempts','learning_enrollments','learning_grants','learning_audit_events','learning_sessions'])
    await setup.query(`DELETE FROM ${table} WHERE program_id=$1 AND workspace_id=$2`,[ids.program,ids.workspace]);
   await setup.query('DELETE FROM learning_programs WHERE id=$1 AND workspace_id=$2',[ids.program,ids.workspace]);
   await setup.query('DELETE FROM workspaces WHERE id=$1',[ids.workspace]);
   await setup.query('DELETE FROM organizations WHERE id=$1',[ids.org]);
   await setup.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[ids.manager,ids.learner]]);
   fixtureCleanup='completed';
  }
 }catch{fixtureCleanup='failed';process.exitCode=1;}
 for(const c of clients)await c.end().catch(()=>{});
 const sources=[];
 for(const [path,contents] of sourceContents)
  sources.push({path,sha256:createHash('sha256').update(contents).digest('hex')});
 await writeFile(resolve(outputDirectory,'admin-concurrency.json'),JSON.stringify({
  environment:'Isolated loopback PostgreSQL; actual admin.ts and learningWriteGuard source; synthetic actor adapter, no HTTP authentication claim',
  createdAt:new Date().toISOString(),fixtureCleanup,failure,unrun:4-results.length,sources,results,
 },null,2),{mode:0o600});
}
