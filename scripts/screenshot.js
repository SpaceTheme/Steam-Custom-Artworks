const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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
  const gameIds = [];
  const elementIds = ['grid', 'p', 'hero'];

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
      gameIds.push(appId);
    } catch (error) {
      console.error('Error processing file:', file, error);
    }
  }

  console.log('Closing browser');
  await browser.close();
  fs.writeFileSync('game_ids.txt', gameIds.join('\n'));
  console.log('Game IDs saved:', gameIds);
})();
