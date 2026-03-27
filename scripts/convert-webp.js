const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  console.log('Starting conversion of images to WebP...');

  const findHtmlFiles = (dir, fileList = []) => {
    if (!fs.existsSync(dir)) return [];
    
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        findHtmlFiles(filePath, fileList);
      } else if (file === 'index.html') {
        fileList.push(filePath);
      }
    }
    
    return fileList;
  };

  const htmlFiles = findHtmlFiles('artworks');
  let conversionCount = 0;

  for (const htmlFile of htmlFiles) {
    const dir = path.dirname(htmlFile);

    const extensionsToConvert = ['.png', '.jpg', '.jpeg'];
    let oldImagePath = null;
    let oldExt = null;
    
    for (const ext of extensionsToConvert) {
      const testPath = path.join(dir, `imageSource${ext}`);
      if (fs.existsSync(testPath)) {
        oldImagePath = testPath;
        oldExt = ext;
        break;
      }
    }

    if (oldImagePath) {
      console.log(`Found image to convert: ${oldImagePath}`);
      const newImagePath = path.join(dir, 'imageSource.webp');
      
      try {
        // convert2webp
        await sharp(oldImagePath)
          .webp({ quality: 90 })
          .toFile(newImagePath);
        console.log(`Successfully converted to ${newImagePath}`);
        
        // rem old img
        fs.unlinkSync(oldImagePath);
        console.log(`Replaced old image ${oldExt} with .webp`);
        
        // update html
        let htmlContent = fs.readFileSync(htmlFile, 'utf8');
        const oldImageNameRegex = new RegExp(`imageSource\\${oldExt}`, 'g');
        const updatedHtmlContent = htmlContent.replace(oldImageNameRegex, 'imageSource.webp');
        
        if (htmlContent !== updatedHtmlContent) {
          fs.writeFileSync(htmlFile, updatedHtmlContent);
          console.log(`Updated reference in ${htmlFile}`);
        }
        
        conversionCount++;
      } catch (e) {
        console.error(`Failed to convert ${oldImagePath}:`, e);
      }
    }
  }

  console.log(`Conversion completed. Total images converted: ${conversionCount}`);
})();
