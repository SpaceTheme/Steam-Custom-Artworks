const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

(async () => {
  console.log('Starting screenshot process');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  console.log('Browser launched');
  const page = await browser.newPage();
  console.log('Page created');

  const files = fs.readdirSync('artworks', { recursive: true })
    .filter(f => f.endsWith('index.html'))
    .map(f => path.join('artworks', f));
  console.log('Found HTML files:', files);

  if (files.length === 0) {
    console.log('No index.html files found, skipping screenshotting');
    await browser.close();
    fs.writeFileSync('game_ids.txt', '');
    return;
  }

  fs.mkdirSync('screenshots/grid', { recursive: true });
  const elementIds = ['grid', 'p', 'hero'];
  const blankPage = await browser.newPage();
  await blankPage.setViewport({width: 1, height: 1});
  const transparentLogoBuffer = await blankPage.screenshot({ omitBackground: true });
  await blankPage.close();

  for (const file of files) {
    const appId = path.basename(path.dirname(file));
    console.log('Processing file:', file, 'with appId:', appId);
    try {
      await page.goto('file://' + path.resolve(file), { waitUntil: 'load', timeout: 30000 });
      console.log('Page loaded:', file);
      const images = await page.$$eval('img', imgs => imgs.map(img => ({
        src: img.src,
        complete: img.complete,
        width: img.naturalWidth,
        height: img.naturalHeight
      })));
      console.log('Images in page:', images);
      for (const elementId of elementIds) {
        console.log('Selecting element:', elementId);
        const element = await page.$('#' + elementId);
        console.log('Element', elementId, 'found:', !!element);
        if (element) {
          let fileName;
          if (elementId === 'grid') {
            fileName = `${appId}p.png`;
          } else if (elementId === 'p') {
            fileName = `${appId}.png`;
          } else {
            fileName = `${appId}_${elementId}.png`;
          }
          await element.screenshot({ path: `screenshots/grid/${fileName}` });
          console.log('Screenshot taken for', elementId);
        }
      }
      fs.writeFileSync(`screenshots/grid/${appId}_logo.png`, transparentLogoBuffer);
      console.log('Screenshot taken for logo (transparent blank)');
    } catch (error) {
      console.error('Error processing file:', file, error);
    }
  }

  console.log('Closing browser');
  await browser.close();

  // Convert PNG to WebP and back to PNG
  console.log('Starting PNG to WebP conversion');
  try {
    const screenshotDir = 'screenshots/grid';
    // Convert all PNG files to WebP with quality 90
    execSync(`cd ${screenshotDir} && for i in *.png; do cwebp -q 90 "$i" -o "\${i%.png}.webp"; done`, {
      stdio: 'inherit',
      shell: '/bin/bash'
    });
    console.log('PNG to WebP conversion completed');

    // Rename WebP files back to PNG
    execSync(`cd ${screenshotDir} && for i in *.webp; do mv "$i" "\${i%.webp}.png"; done`, {
      stdio: 'inherit',
      shell: '/bin/bash'
    });
    console.log('WebP to PNG renaming completed');
  } catch (error) {
    console.error('Error during image conversion:', error);
    process.exit(1);
  }
})();
