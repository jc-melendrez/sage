const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../android/gradle/wrapper/gradle-wrapper.properties');

if (!fs.existsSync(file)) {
  console.log('⚠️  gradle-wrapper.properties not found, skipping patch.');
  process.exit(0);
}

let content = fs.readFileSync(file, 'utf8');

const before = content;
content = content.replace(
  /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-.*-bin\.zip/,
  'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip'
);

if (content !== before) {
  fs.writeFileSync(file, content);
  console.log('✅ Patched gradle-wrapper.properties → gradle-8.13');
} else {
  console.log('ℹ️  gradle-wrapper.properties already patched or pattern not found.');
}