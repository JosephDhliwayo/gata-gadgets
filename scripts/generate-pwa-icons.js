const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'public', 'img', 'logo.jpg');
const OUT_DIR = path.join(__dirname, '..', 'public', 'img');
const BG = '#17181f'; // matches --navy in style.css

async function makeIcon(size, filename) {
  const inner = Math.round(size * 0.78);
  const logoBuf = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: BG })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG }
  })
    .composite([{ input: logoBuf, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT_DIR, filename));

  console.log('Wrote', filename);
}

(async () => {
  await makeIcon(192, 'icon-192.png');
  await makeIcon(512, 'icon-512.png');
  await makeIcon(180, 'apple-touch-icon.png');
})();
