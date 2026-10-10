const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'app/src');

console.log('1. Moving audioUtils.js to app/src/utils/audioUtils.js');
const audioSrc = path.join(src, 'audioUtils.js');
const audioDst = path.join(src, 'utils/audioUtils.js');
if (fs.existsSync(audioSrc)) {
  fs.copyFileSync(audioSrc, audioDst);
  fs.unlinkSync(audioSrc);
  console.log('Moved audioUtils.js successfully');
} else {
  console.log('audioUtils.js already moved or missing');
}

console.log('2. Moving chatTimelineHelpers.js to app/src/features/conversations/utils/chatTimelineHelpers.js');
const chatSrc = path.join(src, 'chatTimelineHelpers.js');
const chatDst = path.join(src, 'features/conversations/utils/chatTimelineHelpers.js');
if (fs.existsSync(chatSrc)) {
  let content = fs.readFileSync(chatSrc, 'utf8');
  // Update import of dataService
  content = content.replace("from './dataService.js'", "from '../../../dataService.js'");
  fs.writeFileSync(chatDst, content, 'utf8');
  fs.unlinkSync(chatSrc);
  console.log('Moved chatTimelineHelpers.js successfully');
} else {
  console.log('chatTimelineHelpers.js already moved or missing');
}

// 3. Update audioUtils consumers
const audioUpdates = [
  { file: 'app/src/audioPlayer.test.js', from: "from './audioUtils.js'", to: "from './utils/audioUtils.js'" },
  { file: 'app/src/components/AudioMessagePlayer.jsx', from: "from '../audioUtils.js'", to: "from '../utils/audioUtils.js'" },
  { file: 'app/src/dataService.js', from: "from './audioUtils.js'", to: "from './utils/audioUtils.js'" },
  { file: 'app/src/features/conversations/components/ConversationComposer.jsx', from: "from '../../../audioUtils.js'", to: "from '../../../utils/audioUtils.js'" },
  { file: 'app/src/features/conversations/components/Conversations.jsx', from: "from '../../../audioUtils.js'", to: "from '../../../utils/audioUtils.js'" },
  { file: 'app/src/features/conversations/components/ConversationSidebar.jsx', from: "from '../../../audioUtils.js'", to: "from '../../../utils/audioUtils.js'" },
  { file: 'app/src/features/conversations/components/ConversationTimeline.jsx', from: "from '../../../audioUtils.js'", to: "from '../../../utils/audioUtils.js'" },
  { file: 'app/src/features/conversations/components/LocationAttachment.jsx', from: "from '../../../audioUtils.js'", to: "from '../../../utils/audioUtils.js'" },
  { file: 'app/src/features/conversations/components/MediaAttachment.jsx', from: "from '../../../audioUtils.js'", to: "from '../../../utils/audioUtils.js'" },
  { file: 'app/src/features/conversations/utils/mediaPresentation.js', from: "from '../../../audioUtils.js'", to: "from '../../../utils/audioUtils.js'" },
  { file: 'app/src/features/dashboard/components/Dashboard.jsx', from: "from '../../../audioUtils'", to: "from '../../../utils/audioUtils'" },
  { file: 'app/src/features/kanban/components/Kanban.jsx', from: "from '../../../audioUtils'", to: "from '../../../utils/audioUtils'" },
  { file: 'app/src/kanban.test.js', from: "from './audioUtils.js'", to: "from './utils/audioUtils.js'" },
  { file: 'app/src/services/conversations/conversationPresentation.js', from: "from '../../audioUtils.js'", to: "from '../../utils/audioUtils.js'" },
  { file: 'app/src/services/kanban/applyIncomingEvent.js', from: "from '../../audioUtils.js'", to: "from '../../utils/audioUtils.js'" },
  { file: 'app/src/services/media/mediaNormalization.js', from: "from '../../audioUtils.js'", to: "from '../../utils/audioUtils.js'" },
];

for (const u of audioUpdates) {
  const p = path.join(root, u.file);
  let c = fs.readFileSync(p, 'utf8');
  if (c.includes(u.from)) {
    c = c.replace(u.from, u.to);
    fs.writeFileSync(p, c, 'utf8');
    console.log(`Updated audioUtils reference in ${u.file}`);
  } else {
    console.log(`Warning: ${u.from} not found in ${u.file}`);
  }
}

// 4. Update chatTimelineHelpers consumers
const chatUpdates = [
  { file: 'app/src/chatTimeline.test.js', from: "from './chatTimelineHelpers.js'", to: "from './features/conversations/utils/chatTimelineHelpers.js'" },
  { file: 'app/src/components/ui/ContactAvatar.jsx', from: "from '../../chatTimelineHelpers'", to: "from '../../features/conversations/utils/chatTimelineHelpers'" },
  { file: 'app/src/features/conversations/components/AudioRecoveryNotice.jsx', from: "from '../../../chatTimelineHelpers.js'", to: "from '../utils/chatTimelineHelpers.js'" },
  { file: 'app/src/features/conversations/components/ConversationComposer.jsx', from: "from '../../../chatTimelineHelpers.js'", to: "from '../utils/chatTimelineHelpers.js'" },
  { file: 'app/src/features/conversations/components/Conversations.jsx', from: "from '../../../chatTimelineHelpers.js'", to: "from '../utils/chatTimelineHelpers.js'" },
  { file: 'app/src/features/conversations/components/ConversationSidebar.jsx', from: "from '../../../chatTimelineHelpers.js'", to: "from '../utils/chatTimelineHelpers.js'" },
];

for (const u of chatUpdates) {
  const p = path.join(root, u.file);
  let c = fs.readFileSync(p, 'utf8');
  if (c.includes(u.from)) {
    c = c.replace(u.from, u.to);
    fs.writeFileSync(p, c, 'utf8');
    console.log(`Updated chatTimelineHelpers reference in ${u.file}`);
  } else {
    console.log(`Warning: ${u.from} not found in ${u.file}`);
  }
}

// 5. Update conversationsPresentation.test.js assertions
const convTestPath = path.join(root, 'app/src/conversationsPresentation.test.js');
let convTestContent = fs.readFileSync(convTestPath, 'utf8');

// Line 120
convTestContent = convTestContent.replace(
  "assert.match(code, /from '\\.\\.\\/\\.\\.\\/\\.\\.\\/chatTimelineHelpers\\.js'/, 'AudioRecoveryNotice deve importar de chatTimelineHelpers.js');",
  "assert.match(code, /from '\\.\\.\\/utils\\/chatTimelineHelpers\\.js'/, 'AudioRecoveryNotice deve importar de chatTimelineHelpers.js');"
);

// Line 143
convTestContent = convTestContent.replace(
  "assert.match(code, /import\\s+\\{\\s*formatCoordinates\\s*\\}\\s+from\\s+'\\.\\.\\/\\.\\.\\/\\.\\.\\/audioUtils\\.js'/, 'LocationAttachment deve importar formatCoordinates');",
  "assert.match(code, /import\\s+\\{\\s*formatCoordinates\\s*\\}\\s+from\\s+'\\.\\.\\/\\.\\.\\/\\.\\.\\/utils\\/audioUtils\\.js'/, 'LocationAttachment deve importar formatCoordinates');"
);

// Line 169
convTestContent = convTestContent.replace(
  "assert.match(code, /import\\s+\\{[\\s\\S]*REAL_MEDIA_KINDS[\\s\\S]*\\}\\s+from\\s+'\\.\\.\\/\\.\\.\\/\\.\\.\\/audioUtils\\.js'/, 'MediaAttachment deve importar de audioUtils.js');",
  "assert.match(code, /import\\s+\\{[\\s\\S]*REAL_MEDIA_KINDS[\\s\\S]*\\}\\s+from\\s+'\\.\\.\\/\\.\\.\\/\\.\\.\\/utils\\/audioUtils\\.js'/, 'MediaAttachment deve importar de audioUtils.js');"
);

// Line 182
convTestContent = convTestContent.replace(
  "assert.match(code, /import\\s+\\{[\\s\\S]*groupTimelineMessages[\\s\\S]*\\}\\s+from\\s+'\\.\\.\\/\\.\\.\\/\\.\\.\\/chatTimelineHelpers\\.js'/, 'Conversations deve importar de chatTimelineHelpers.js');",
  "assert.match(code, /import\\s+\\{[\\s\\S]*groupTimelineMessages[\\s\\S]*\\}\\s+from\\s+'\\.\\.\\/utils\\/chatTimelineHelpers\\.js'/, 'Conversations deve importar de chatTimelineHelpers.js');"
);

fs.writeFileSync(convTestPath, convTestContent, 'utf8');
console.log('Updated conversationsPresentation.test.js assertions successfully');
