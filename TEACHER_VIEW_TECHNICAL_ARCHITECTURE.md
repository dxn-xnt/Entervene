# Teacher View Improvements - Technical Architecture

## 📐 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Teacher Dashboard                      │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
   [Classworks]             [Classwork Detail]
   List Page                [classwork-detail.tsx]
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
            [FileViewer]    [SubmissionMonitor]  [Edit ✏️]
            (New Component)  (New Component)  [edit-classwork.tsx]
                    │             │
    ┌───────────────┴─┐  ┌────────┴──────────┐
    │                 │  │                   │
  [Open]         [Download]         [Grade Page]
  (Web Browser)  (expo-sharing)   (Existing Page)
```

## 🔧 Component Dependencies

### FileViewer Component
```typescript
// Dependencies
import * as WebBrowser from 'expo-web-browser';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

// Data Flow
Props: files[] → Display → Action (Open/Download)
```

### SubmissionMonitor Component
```typescript
// Dependencies
import { useRouter } from 'expo-router';
import { SubmissionTrackingStudent } from '@/hooks/useSubmissions';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

// Data Flow
Props: submitted[], missing[] → Display Sections → Navigation
```

### Edit Classwork Page
```typescript
// Dependencies
import { useRouter, useLocalSearchParams } from 'expo-router';
import { apiFetch, apiUploadSingle } from '@/hooks/api';
import { useTeacherClasses } from '@/hooks/useTeacherData';
import { useAuth } from '@/context/AuthContext';

// Data Flow
Load Existing Data → Edit → PUT Request → Upload Files → Navigate Back
```

## 🔌 API Integration Points

### 1. Fetch Classwork Details
```typescript
// Endpoint: GET /api/v1/classwork-assignments/classwork/{classwork_id}
const data = await apiFetch<ClassworkDetailData>(
  `/api/v1/classwork-assignments/classwork/${classworkId}`,
  { token: session.token }
);

// Response Type
type ClassworkDetailData = {
  classwork_id: number;
  title: string;
  description: string | null;
  instructions: string | null;
  classwork_type: string;
  classwork_category: string | null;
  total_points: number | null;
  is_published: boolean;
  is_locked: boolean;
  subject_id: number;
  subject_name: string | null;
  teacher_name: string | null;
  attachments: Array<{
    classwork_attachment_id: number;
    file_name: string;
    file_size?: number;
  }>;
  created_at?: string | null;
  updated_at?: string | null;
};
```

### 2. Update Classwork
```typescript
// Endpoint: PUT /api/v1/classwork-assignments/classwork/{classwork_id}
await apiFetch(`/api/v1/classwork-assignments/classwork/${classworkId}`, {
  method: 'PUT',
  token: session.token,
  body: JSON.stringify({
    title: string;
    description: string;
    instructions: string;
    classwork_type: string;
    classwork_category: string | null;
    total_points: number;
  }),
});

// Authorization: Only creator can update (backend enforced)
```

### 3. Upload Attachments
```typescript
// Endpoint: POST /api/v1/classwork-assignments/classwork/{classwork_id}/attachments
await apiUploadSingle(
  `/api/v1/classwork-assignments/classwork/${classworkId}/attachments`,
  file,
  session.token
);

// File Type: { uri, name, type, webFile? }
// Max Size: 4MB (enforced)
```

### 4. Get Submission Tracking
```typescript
// Hook: useAssignmentSubmissionTracking(assignmentId)
const { tracking, isLoading, error, refresh } = useAssignmentSubmissionTracking(classworkId);

// Endpoint: GET /api/v1/submissions/assignment/{assignmentId}/tracking
// Response Type
type AssignmentSubmissionTracking = {
  classwork_assignment_id: number;
  classwork_id: number;
  classwork_title: string | null;
  class_id: number;
  due_date: string | null;
  total_students: number;
  submitted_count: number;
  missing_count: number;
  submitted: SubmissionTrackingStudent[];
  missing: SubmissionTrackingStudent[];
};

type SubmissionTrackingStudent = {
  student_id: string;
  student_name: string;
  student_lrn: string | null;
  email: string | null;
  status: string;
  submitted_at: string | null;
  submission_id: number | null;
  attempt_count: number;
  grade: number | null;
  attachment_count: number;
};
```

## 📊 Data Flow Diagrams

### Viewing Classwork Workflow
```
User Opens Classwork
        ↓
classwork-detail.tsx useEffect()
        ↓
apiFetch GET /classwork/{id}
        ↓
Receive ClassworkDetailData
        ↓
Render:
├─ Header with Edit button ✏️
├─ Hero section (title, badges)
├─ Description block
├─ Instructions block
├─ FileViewer component
│  └─ Display attachments
└─ SubmissionMonitor component
   ├─ useAssignmentSubmissionTracking hook
   ├─ Fetch tracking data
   └─ Display summary + sections
```

### Editing Classwork Workflow
```
Click Edit Button (✏️)
        ↓
Navigate to /edit-classwork
        ↓
edit-classwork.tsx useEffect()
        ↓
apiFetch GET /classwork/{id}
        ↓
Populate form fields
        ↓
User edits fields
        ↓
User clicks "Save Changes"
        ↓
Validation (title required)
        ↓
apiFetch PUT /classwork/{id}
        ↓
For each new file:
  apiUploadSingle() to attachments endpoint
        ↓
Success alert
        ↓
Navigate back to classwork-detail
        ↓
classwork-detail reloads data
```

### File Viewing Workflow
```
FileViewer Component
        ↓
Receive files[]
        ↓
For each file:
├─ Get file icon (by extension)
├─ Format file size
└─ Render card with:
   ├─ Icon + name + size
   ├─ Open button (👁️)
   └─ Download button (⬇️)
        ↓
On Open click:
└─ expo-web-browser.openBrowserAsync(fileUrl)
        ↓
On Download click:
└─ expo-sharing.shareAsync(fileUrl)
```

### Submission Monitoring Workflow
```
SubmissionMonitor Component
        ↓
Receive submitted[], missing[]
        ↓
Render summary stats
├─ submitted.length
├─ missing.length
└─ total_students
        ↓
For submitted section:
├─ Green "Submitted" header
└─ For each student:
   ├─ Name + timestamp
   ├─ File count + attempts
   ├─ Grade (if graded)
   ├─ Status badge
   └─ On click → navigate to grade page
        ↓
For missing section:
├─ Red "Not Submitted" header
└─ For each student:
   ├─ Name + email
   ├─ Status: "NOT SUBMITTED"
   └─ Gray card (not clickable)
```

## 🎯 State Management

### classwork-detail.tsx State
```typescript
const [cw, setCw] = useState<ClassworkDetailData | null>(null);
const [loading, setLoading] = useState(true);

// From hooks
const { tracking, isLoading: submissionsLoading } = useAssignmentSubmissionTracking(classworkId);

// Lifecycle
useEffect() → Load classwork on mount
           → Set loading states
           → Update when classwork_id changes
```

### edit-classwork.tsx State
```typescript
const [cw, setCw] = useState<ClassworkData | null>(null);
const [title, setTitle] = useState('');
const [description, setDescription] = useState('');
const [instructions, setInstructions] = useState('');
const [cwType, setCwType] = useState<typeof TYPES[number]>('ASSIGNMENT');
const [cwCategory, setCwCategory] = useState<string | null>(null);
const [totalPoints, setTotalPoints] = useState('100');
const [newFiles, setNewFiles] = useState([]);
const [removedAttachments, setRemovedAttachments] = useState([]);
const [saving, setSaving] = useState(false);
const [loading, setLoading] = useState(true);

// Lifecycle
useEffect() → Load classwork data on mount
           → Parse and populate form
           → Set ready state
```

### FileViewer Component State
```typescript
const [downloadingId, setDownloadingId] = useState<number | null>(null);

// Tracks which file is currently downloading
```

### SubmissionMonitor Component State
```typescript
// No local state - all props driven
// State managed by parent (classwork-detail.tsx)
```

## 🔐 Security Considerations

### 1. Authorization
- **Backend enforces**: Only teacher who created classwork can edit
- **Check**: `created_by_staff_id === current_user_id`
- **Error**: Returns 404 if unauthorized

### 2. File Security
- **Max size**: 4MB per file
- **Allowed types**: PDF, DOCX, PPTX, JPG, PNG
- **Upload path**: `/api/v1/classwork-assignments/classwork/{id}/attachments`
- **Validation**: Backend validates file type and size

### 3. Token Management
- **Session token required**: All endpoints need bearer token
- **Stored in**: AuthContext
- **Passed via**: headers Authorization: Bearer {token}
- **Expiration**: Handled by session-expired.ts

## 🧪 Testing Strategy

### Unit Tests Needed
- [ ] FileViewer - file type icon detection
- [ ] FileViewer - file size formatting
- [ ] SubmissionMonitor - summary calculation
- [ ] SubmissionMonitor - section filtering

### Integration Tests Needed
- [ ] classwork-detail → FileViewer data flow
- [ ] classwork-detail → SubmissionMonitor data flow
- [ ] edit-classwork → form population
- [ ] edit-classwork → PUT request flow
- [ ] Navigation between detail and edit pages

### E2E Tests Needed
- [ ] Complete edit workflow
- [ ] File upload and display
- [ ] Submission monitoring
- [ ] Grade submission from monitor

## 🚀 Performance Optimization

### Current Optimizations
1. **Lazy Loading**: useEffect only loads when mount or params change
2. **Memoization**: Components don't re-render unnecessarily
3. **Hook Efficiency**: useAssignmentSubmissionTracking cached
4. **Early Returns**: Empty states prevent unnecessary renders

### Future Optimizations
- [ ] Add React.memo() for FileViewer list items
- [ ] Implement infinite scroll for large submission lists
- [ ] Cache submission data in context
- [ ] Debounce file search/filter
- [ ] Virtual scrolling for large lists

## 📝 Code Style & Conventions

### File Organization
```
mobile-app/
├── app/
│   └── teacher/
│       ├── classwork-detail.tsx (modified)
│       ├── edit-classwork.tsx (new)
│       └── _layout.tsx (modified)
├── components/
│   └── teacher/
│       ├── file-viewer.tsx (new)
│       └── submission-monitor.tsx (new)
└── hooks/
    └── useSubmissions.ts (existing, used)
```

### Naming Conventions
- Components: PascalCase (FileViewer, SubmissionMonitor)
- Functions: camelCase (handleSave, formatDate)
- Variables: camelCase (classworkId, isLoading)
- Constants: UPPER_SNAKE_CASE (MAX_FILE_SIZE, TYPES)
- Types: PascalCase (ClassworkDetailData, FileItem)

### Style System
- Theme colors from `constants/theme.ts`
- Spacing values: Spacing.xs/sm/md/lg/xl
- Border width: Borders.width (1px)
- Shadows: NeoShadow.xs/sm/md
- All StyleSheets at bottom of file

## 🔄 Integration Checklist

- [x] FileViewer component created
- [x] SubmissionMonitor component created
- [x] Edit page created
- [x] classwork-detail updated
- [x] Routes added to _layout
- [x] API endpoints available
- [x] Error handling implemented
- [x] Loading states added
- [x] TypeScript validation
- [x] Theme consistency

## 📚 Related Documentation

- Backend API: backend/app/api/v1/routes/Classworks.py
- Submissions API: backend/app/api/v1/routes/Submissions.py
- Auth Context: mobile-app/context/AuthContext.tsx
- API Helper: mobile-app/hooks/api.ts
- Submission Hooks: mobile-app/hooks/useSubmissions.ts

---

**Architecture Version**: 1.0  
**Last Updated**: May 2026  
**Maintained By**: Development Team
