const fs = require('fs');
const file = 'mobile-app/app/teacher/create-lesson.tsx';
let content = fs.readFileSync(file, 'utf-8');

const oldBlock = `      Alert.alert(
        '✅ Lesson Created',
        \`"\${title}" has been \${isPublished ? 'published' : 'saved as draft'} successfully.\`,
        [{ 
          text: 'OK', 
          onPress: () => goBackToSubject()
        }],
      );`;

const newBlock = `      if (Platform.OS === 'web') {
        setTimeout(() => {
          window.alert(\`✅ Lesson Created\\n"\${title}" has been \${isPublished ? 'published' : 'saved as draft'} successfully.\`);
          goBackToSubject();
        }, 50);
        return;
      }

      setTimeout(() => {
        Alert.alert(
          '✅ Lesson Created',
          \`"\${title}" has been \${isPublished ? 'published' : 'saved as draft'} successfully.\`,
          [{ 
            text: 'OK', 
            onPress: () => goBackToSubject()
          }],
        );
      }, 50);`;

if (content.includes(oldBlock)) {
    content = content.replace(oldBlock, newBlock);
    fs.writeFileSync(file, content, 'utf-8');
    console.log("SUCCESS");
} else {
    // Try to handle \r\n vs \n
    const oldBlockNormalized = oldBlock.replace(/\r\n/g, '\n');
    const contentNormalized = content.replace(/\r\n/g, '\n');
    if (contentNormalized.includes(oldBlockNormalized)) {
        let patched = contentNormalized.replace(oldBlockNormalized, newBlock);
        fs.writeFileSync(file, patched, 'utf-8');
        console.log("SUCCESS NORMALIZED");
    } else {
        console.log("FAILED");
    }
}
