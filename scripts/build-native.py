#!/usr/bin/env python3
"""Compile against real pinned host API sources, never substitute fake host stubs."""
import hashlib, json, os, pathlib, subprocess, urllib.request, urllib.error, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
out = root / 'build/native'; out.mkdir(parents=True, exist_ok=True)
tools = root / 'build/toolchain'
java = tools / 'jdk-25.0.5+8/bin/java'
android = next((tools/'platform').rglob('android.jar'))
r8 = next((tools/'build-tools').rglob('d8.jar'))
host = pathlib.Path(os.environ['VALENCED_SOURCE'])
assert subprocess.check_output(['git', '-C', str(host), 'rev-parse', 'HEAD'], text=True).strip() == 'd3e17fe0416c3dc5f4b4d783b465eeb4a99caec1'
provenance = []
def maven(group, artifact, version, ext='jar', base='https://repo.maven.apache.org/maven2'):
    url = f'{base}/{group.replace(".", "/")}/{artifact}/{version}/{artifact}-{version}.{ext}'
    dest = out / url.rsplit('/',1)[1]
    if not dest.exists(): urllib.request.urlretrieve(url, dest)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    try:
        expected = urllib.request.urlopen(url+'.sha256').read().decode().split()[0].lower()
        assert digest == expected
    except urllib.error.HTTPError:
        try:
            expected = urllib.request.urlopen(url+'.sha1').read().decode().split()[0].lower()
            assert hashlib.sha1(dest.read_bytes()).hexdigest() == expected
        except urllib.error.HTTPError:
            if base != 'https://api.xposed.info': raise
            assert digest == 'f48c635f1c7469fdec0e00ad2ea0b7a6b2f5b55065784a35b7ca3a84615e8e25', 'Xposed archive drift'
            print('Xposed upstream publishes no checksum sidecar; HTTPS source + recorded SHA256:', digest, flush=True)
    provenance.append({'url':url,'sha256':digest})
    if ext == 'aar':
        jar = dest.with_suffix('.jar')
        with zipfile.ZipFile(dest) as z: jar.write_bytes(z.read('classes.jar'))
        return jar
    return dest
compiler = maven('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.4.10')
stdlib = maven('org.jetbrains.kotlin', 'kotlin-stdlib', '2.4.10')
compiler_cp = [compiler, stdlib,
    maven('org.jetbrains.kotlin','kotlin-build-tools-api','2.4.10'),
    maven('org.jetbrains.kotlin','kotlin-script-runtime','2.4.10'),
    maven('org.jetbrains.kotlin','kotlin-reflect','1.6.10'),
    maven('org.jetbrains.kotlin','kotlin-daemon-embeddable','2.4.10'),
    maven('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.8.0'),
    maven('org.jetbrains','annotations','26.0.2')]
cp = [android, stdlib, maven('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.11.0'),
    maven('org.luckypray','dexkit','2.3.0','aar'),
    maven('de.robv.android.xposed','api','82',base='https://api.xposed.info')]
api = host/'android/api/src/main/kotlin'
core = host/'core/src/commonMain/kotlin/app/valenced/plugins'
sources = list(api.rglob('*.kt')) + [core/'PluginManifest.kt', core/'Version.kt']
generated = out/'ApiVersion.kt'; generated.write_text('package app.valenced.core\nconst val API_VERSION_STRING: String = "1.0.0"\n')
sources.append(generated)
for source in sources:
    if source != generated:
        committed = subprocess.check_output(['git','-C',str(host),'show',f'HEAD:{source.relative_to(host)}'])
        assert source.read_bytes() == committed, 'Host source differs from pinned commit'
(out/'host-source-manifest.json').write_text(json.dumps({str(p.relative_to(host)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources if p != generated},indent=2)+'\n')
def compile(sources, dest, classpath):
    subprocess.run([str(java), '-cp', ':'.join(map(str, compiler_cp)), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
      '-no-stdlib','-no-reflect','-jvm-target','17','-classpath',':'.join(map(str, classpath)), '-d', str(dest), *map(str,sources)], check=True)
api_jar = out/'host-api.jar'; compile(sources,api_jar,cp)
jar = out/'elevenlabs-jvm.jar'
compile(list((root/'plugins/elevenlabs-transcription/android').glob('*.kt')),jar,cp+[api_jar])
tests = out/'native-tests.jar'
compile(list((root/'plugins/elevenlabs-transcription/android').glob('*.kt')) + list((root/'tests/native').glob('*.kt')), tests, cp+[api_jar])
subprocess.run([str(java), '-cp', ':'.join(map(str, cp+[api_jar,tests])), 'app.anezium.elevenlabs.NativeTestKt'], check=True)
dex = out/'dex'; dex.mkdir(exist_ok=True)
subprocess.run([str(java),'-cp',str(r8),'com.android.tools.r8.D8','--min-api','24','--lib',str(android),
    *sum([['--classpath',str(p)] for p in cp[1:]+[api_jar]],[]),'--output',str(dex),str(jar)],check=True)
assert (dex/'classes.dex').read_bytes().startswith(b'dex\n')
package = root/'plugins/elevenlabs-transcription/build/android'; package.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(package/'elevenlabs.jar','w',zipfile.ZIP_DEFLATED) as z:
    info = zipfile.ZipInfo('classes.dex', (2026,1,1,0,0,0)); info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info,(dex/'classes.dex').read_bytes())
(out/'dependencies.json').write_text(json.dumps(provenance,indent=2)+'\n')
print('Real host source compilation + plugin JVM + D8 DEX: PASS')
