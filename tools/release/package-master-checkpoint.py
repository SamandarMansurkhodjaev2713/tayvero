"""Package a clean checkpoint from the repository root; --audit-only also checks unstaged delivery files.

Requires Python 3 and Node. MASTER_REPORT must contain executed Linux test counts.
The external SHA/report/status sidecars describe final ZIP bytes without a self-hash cycle.
"""
from pathlib import Path
import subprocess, json, zipfile, hashlib, uuid, re, sys
root=Path.cwd().resolve()
parent=root.parent
auditOnly='--audit-only' in sys.argv
assert auditOnly or subprocess.check_output(['git','status','--porcelain']).decode().strip() == '', 'Finalize and commit source before packaging'
sourceCommit=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
report=json.loads((root/'MASTER_REPORT.json').read_text(encoding='utf-8'))
verifiedCiCommit=report.get('checks',{}).get('fullQualityGate',{}).get('sourceCommit')
postCiChanges=[]
if not auditOnly:
    assert verifiedCiCommit and report['checks']['fullQualityGate']['status']=='PASSED', 'Finalize executed source CI evidence first'
    postCiChanges=subprocess.check_output(['git','diff','--name-only',verifiedCiCommit,sourceCommit]).decode('utf-8').splitlines()
    permitted={'README.md','.gitignore','tools/release/package-master-checkpoint.py'}
    assert all(name in permitted or name.startswith('MASTER_') or name.startswith('docs/') for name in postCiChanges), 'Application source differs from verified CI commit'
expectedTests=report['checks']['linuxLocal']['tests']
knownFailures=json.loads((root/'docs/quality/windows-retained-posix-failures.json').read_text(encoding='utf-8'))['failedTitles']
files=[x for x in subprocess.check_output(['git','ls-files','-z']).decode('utf-8').split('\0') if x]
if auditOnly:
    files=sorted(set(files+[x for x in subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z']).decode('utf-8').split('\0') if x]))
required={'README.md','LICENSE','package.json','bun.lock','DESIGN.md','MASTER_STATUS.md','MASTER_REPORT.json','MASTER_SHA256.txt','MASTER_BUILD.log','MASTER_EXTERNAL_GATES.md','MASTER_NEXT_SCOPE.md','MASTER_AUDIT.md','MASTER_UX_AUDIT.md'}
assert required.issubset(set(files)), required-set(files)
assert any(n.startswith('packages/db/prisma/migrations/') for n in files), 'Migrations missing'
assert any('/test/' in n for n in files), 'Tests missing'
assert any(n.startswith('docs/adr/') or n.startswith('docs/architecture/') for n in files), 'Architecture decisions missing'
assert len(files)==len(set(files)), 'Duplicate source paths'
for name in files:
    parts=Path(name).parts
    assert not any(p in {'.git','node_modules','.next','.eve','.turbo','.scratch','dist','.cache','coverage','build','out','.output','__pycache__'} for p in parts),name
    assert not (Path(name).name.startswith('.env') and Path(name).name!='.env.example'),name
    assert not name.endswith(('.zip','.tsbuildinfo','.pem','.key','.db','.sqlite','.sqlite3','.pyc')),name
    assert (root/name).is_file(),name
    assert not (root/name).is_symlink(),name
tokenPatterns=[r'\bsk-[A-Za-z0-9_-]{20,}\b',r'\bAIza[0-9A-Za-z_-]{30,}\b',r'\bgh[pousr]_[A-Za-z0-9]{30,}\b',r'\bgithub_pat_[A-Za-z0-9_]{30,}\b',r'\bxox[baprs]-[A-Za-z0-9-]{20,}\b',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
sourceHashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}
secretFindings=[]
textFiles=0
for name in files:
    try: content=(root/name).read_bytes().decode('utf-8')
    except UnicodeDecodeError: continue
    textFiles+=1
    for index,pattern in enumerate(tokenPatterns):
        if re.search(pattern,content): secretFindings.append({'file':name,'patternIndex':index,'value':'REDACTED'})
    if name.endswith('.log') and re.search(r'postgres(?:ql)?://[^\s"\'<>]+',content,re.I):
        secretFindings.append({'file':name,'kind':'Unredacted database URL in log','value':'REDACTED'})
assert not secretFindings, secretFindings
if auditOnly:
    print(json.dumps({'sourceFiles':len(files),'textFiles':textFiles,'secretPatterns':'PASSED','logsIncluded':True,'envExampleExempted':False}))
    sys.exit(0)
archiveName=report['artifact']['name']
assert re.fullmatch(r'tayvero-master-\d{4}-\d{2}-\d{2}\.zip',archiveName), 'Invalid checkpoint archive name'
archive=parent/archiveName
staging=parent/('.tayvero-master-staging-'+str(uuid.uuid4())[:8]+'.zip')
with zipfile.ZipFile(staging,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name in sorted(files): z.write(root/name,'crm-release/'+name.replace('\\','/'))
with zipfile.ZipFile(staging) as z:
    assert z.testzip() is None,'CRC failure'
    assert len(z.namelist())==len(files)
    assert all(n.startswith('crm-release/') and '..' not in Path(n).parts for n in z.namelist())
    fresh=parent/('.release-verify-'+report['releaseDate'].replace('-','')+'-'+str(uuid.uuid4())[:8])
    fresh.mkdir()
    z.extractall(fresh)
checkroot=fresh/'crm-release'
assert all((checkroot/name).read_bytes()==(root/name).read_bytes() for name in files), 'Fresh extraction differs from source'
checks=[]
for args in [
    ['node','scripts/verify-manifests.mjs'],
    ['node','tools/quality/verify-workspace-lock.mjs'],
    ['node','tools/quality/generate-appearance.mjs','--check'],
    ['node','tools/quality/check-esm.mjs'],
    ['node','scripts/repository-audit.mjs'],
    ['node','tools/quality/audit-agent-action-boundaries.mjs','--check','--strict-legacy'],
    ['node','tools/quality/run-local-tests.mjs']
]:
    result=subprocess.run(args,cwd=checkroot,capture_output=True,text=True,encoding='utf-8',errors='replace')
    item={'command':' '.join(args),'exitCode':result.returncode,'status':'passed' if result.returncode==0 else 'failed','stdoutTail':result.stdout[-1800:],'stderrTail':result.stderr[-900:]}
    if args[-1].endswith('run-local-tests.mjs'):
        item['tests']={key:(int(re.findall(r'^# '+key+r' (\d+)\s*$',result.stdout,re.M)[-1]) if re.findall(r'^# '+key+r' (\d+)\s*$',result.stdout,re.M) else None) for key in ['tests','pass','fail','skipped','cancelled','todo']}
        counts=item['tests']
        failedTitles=sorted(re.findall(r'^not ok \d+ - (.+)$',result.stdout,re.M))
        assert counts['tests']==expectedTests and counts['tests']>0,counts
        assert counts['pass']+counts['fail']==counts['tests'],counts
        assert all(counts[key]==0 for key in ['skipped','cancelled','todo']),counts
        if result.returncode==0:
            assert counts['pass']==counts['tests'] and counts['fail']==0 and not failedTitles,counts
            item['scope']='Fresh archive dependency-free replay passed with positive matching counters and zero skips/cancels/todos.'
        else:
            assert sys.platform=='win32' and result.returncode==1 and failedTitles==knownFailures and counts['fail']==len(knownFailures), {'counts':counts,'unexpectedTitles':sorted(set(failedTitles)-set(knownFailures))}
            item['knownFailureSetMatches']=True
            item['scope']='Fresh archive Windows replay matches the exact retained 73 POSIX-unsupported failure titles, with positive matching counters and zero skips/cancels/todos. Linux acceptance is separate CI evidence.'
    else: assert result.returncode==0,item
    checks.append(item)
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()==sourceCommit, 'Source commit changed during verification'
assert subprocess.check_output(['git','status','--porcelain']).decode().strip()=='', 'Source changed during verification'
assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==sourceHashes[name] for name in files), 'Source content changed during verification'
staging.replace(archive)
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
report['artifact'].update({'sha256':sha,'files':len(files),'bytes':archive.stat().st_size,'crc':'PASSED','freshExtract':'PASSED','extractedBytesMatchSource':True,'sourceByteScope':'Clean tracked working checkout at the pinned Git commit; Git line-ending normalization is not asserted as raw blob-byte equality.','requiredFiles':'PASSED','textSecretAudit':{'status':'PASSED','textFiles':textFiles,'logsIncluded':True,'envExampleExempted':False,'scope':'Token/private-key patterns on all UTF-8 source, plus unredacted database URLs in logs; repository audit and masked/redacted CI evidence remain separate controls.'},'freshDirectory':str(fresh),'sourceCommit':sourceCommit,'freshChecks':checks})
report['artifact']['verifiedCiSourceCommit']=verifiedCiCommit
report['artifact']['postCiChanges']=postCiChanges
report['artifact']['applicationSourceMatchesVerifiedCi']=True
(parent/'MASTER_SHA256.txt').write_text(sha+'  '+archive.name+'\n',encoding='utf-8')
(parent/'MASTER_REPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
fresh_tests=checks[-1].get('tests',{})
pack_status='\n## Измеренный финальный артефакт (внешний sidecar)\n\n'+f'Final artifact: `{archive.name}`. Final SHA-256: `{sha}`. Files after: {len(files)}. Bytes: {archive.stat().st_size}. CRC: PASSED. Fresh extract: PASSED; все извлечённые байты совпадают с чистым tracked checkout source commit `{report["artifact"]["sourceCommit"]}`. Required files: PASSED.\n\n'+f'Fresh Windows replay: tests={fresh_tests.get("tests")}, pass={fresh_tests.get("pass")}, fail={fresh_tests.get("fail")}, skip={fresh_tests.get("skipped")}. Ошибки POSIX-защиты не скрыты; Linux CI указан отдельно.\n'
(parent/'MASTER_STATUS.md').write_text((root/'MASTER_STATUS.md').read_text(encoding='utf-8')+pack_status,encoding='utf-8')
(parent/'MASTER_BUILD.log').write_text((root/'MASTER_BUILD.log').read_text(encoding='utf-8')+'\nFresh archive verification:\n'+json.dumps(checks,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'archive':str(archive),'sha256':sha,'files':len(files),'bytes':archive.stat().st_size,'crc':'PASSED','freshExtract':str(fresh),'freshChecks':[{'command':x['command'],'exitCode':x['exitCode'],'tests':x.get('tests')} for x in checks]},ensure_ascii=False))
