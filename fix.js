const fs = require('fs');
const file = 'mobile-app/app/teacher/create-lesson.tsx';
let content = fs.readFileSync(file, 'utf-8');

// The mangled text looks like this:
//         [{ 
//           text: 'OK', 
//           onPress: () => goBackToSubject()
//         }],
//         }],
//       );
//       }, 50);

// We will use a regex to replace the duplicate block
const regex = /\[\{\s*text:\s*'OK',\s*onPress:\s*\(\)\s*=>\s*goBackToSubject\(\)\s*\}\],\s*\}\],\s*\);\s*\}, 50\);/g;

const replacement = `[{ 
          text: 'OK', 
          onPress: () => goBackToSubject()
        }],
      );
      }, 50);`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(file, content, 'utf-8');
    console.log('SUCCESS');
} else {
    console.log('FAILED to find regex');
}
