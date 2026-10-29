#!/usr/bin/env python3
"""Task-local official JDK and SDK archives; no global installs or license acceptance."""
import hashlib, json, pathlib, tarfile, urllib.request, xml.etree.ElementTree as ET, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
out = root / 'build/toolchain'
out.mkdir(parents=True, exist_ok=True)
def fetch(url, dest):
    if not dest.exists():
        print('Download', url, flush=True)
        urllib.request.urlretrieve(url, dest)
    return dest
p = {
    'name': 'OpenJDK25U-jdk_x64_linux_hotspot_25.0.5_8.tar.gz',
    'link': 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jdk_x64_linux_hotspot_25.0.5_8.tar.gz',
    'checksum': '68982529869257d0ee6b824ec5aa270ff8b118bb438670da0b97ebdab178d7fb',
}
archive = fetch(p['link'], out / p['name'])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == p['checksum']
if not (out / 'jdk-25.0.5+8').exists():
    with tarfile.open(archive) as tf: tf.extractall(out, filter='data')
xml = fetch('https://dl.google.com/android/repository/repository2-3.xml', out / 'repository.xml')
tree = ET.parse(xml)
for elem in tree.iter(): elem.tag = elem.tag.rsplit('}', 1)[-1]
manifest = {'jdk': {'url': p['link'], 'sha256': p['checksum']}, 'sdk': []}
for path in ['platforms;android-37.0', 'build-tools;37.0.0']:
    package = next(x for x in tree.getroot().findall('remotePackage') if x.attrib['path'] == path)
    container = package.find('archives'); assert container is not None
    archives = container.findall('archive')
    a = next(x for x in archives if x.findtext('host-os') in [None, 'linux'])
    complete = a.find('complete'); assert complete is not None
    relative = complete.findtext('url'); assert relative is not None
    url = 'https://dl.google.com/android/repository/' + relative
    checksum = complete.find('checksum'); assert checksum is not None and checksum.text is not None
    digest = checksum.text
    archive = fetch(url, out / url.rsplit('/', 1)[1])
    assert hashlib.new(checksum.attrib.get('type', 'sha1'), archive.read_bytes()).hexdigest() == digest
    expected = {'platforms;android-37.0': '840b23e827f96e64aea4c89a1194aac3dc5f6bad37edb231c5c795d890330e8d',
                'build-tools;37.0.0': '01af179347cbcd9c208b7f8171f7b21f6dd1d2f85bcd15e88caa51d5d7b86060'}[path]
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, 'SDK revision drift; review official metadata first'
    dest = out / ('platform' if path.startswith('platforms') else 'build-tools')
    if not dest.exists():
        dest.mkdir()
        with zipfile.ZipFile(archive) as z: z.extractall(dest)
    manifest['sdk'].append({'package': path, 'url': url, 'official_checksum': digest, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()})
(out / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Verified task-local JDK/SDK; SDK licenses are not accepted by this script.', flush=True)
