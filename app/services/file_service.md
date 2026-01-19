# File Service Documentation

## Overview
Service for managing file uploads, storage, and access control with polymorphic associations.

**Files:**
- Service: `app/services/file_service.ts`
- Model: `app/models/file.ts`
- Controller: `app/controllers/file_controller.ts`
- Routes: `start/routes.ts` (section: File Management Routes)

---

## Methods Reference

### Upload
| Method | Description |
|--------|-------------|
| `upload(file, options)` | Upload single file |
| `uploadMultiple(files, options)` | Upload multiple files |
| `copyFile(fileId, newOptions)` | Physical copy of file to new location/owner |

### Retrieval
| Method | Description |
|--------|-------------|
| `getFile(fileId)` | Get file record by ID |
| `getFilesFor(tableName, tableId, column?)` | Get files for entity |
| `getFilesByCategory(tableName, tableId, category)` | Get files by category |
| `readFile(fileId)` | Read file content (with decryption) |
| `fileExists(fileId)` | Check if file exists |
| `listFilesWithAccess(user, tableName, tableId, column?)` | List files with access control filtering |

### Deletion
| Method | Description |
|--------|-------------|
| `deleteFile(fileId)` | Delete single file |
| `deleteFilesFor(tableName, tableId, column?)` | Delete files for entity |

### Permissions & Validation
| Method | Description |
|--------|-------------|
| `canUserAccessFile(file, user)` | Check if user can access file |
| `canUserDeleteFile(user, fileId)` | Check if user can delete file |
| `canUserUpdateFile(user, fileId)` | Check if user can update file permissions |
| `validateUploadOwnership(user, tableName, tableId)` | Validate upload ownership and return company IDs for push-only docs |
| `updatePermissions(fileId, permissions)` | Update file permissions |
| `addAllowedUser(fileId, userId)` | Add user to allowedUserIds |
| `removeAllowedUser(fileId, userId)` | Remove user from allowedUserIds |
| `addAllowedCompany(fileId, companyId)` | Add company to allowedCompanyIds |
| `removeAllowedCompany(fileId, companyId)` | Remove company |

### Utilities
| Method | Description |
|--------|-------------|
| `getAllowedMimeTypes()` | Get list of allowed MIME types |
| `getCategoryInfo()` | Get categories with their MIME types |
| `getMimeTypesForCategories(categories)` | Get MIME types for categories |

---

## File Categories

Categories define what operations can be performed on files.

| Category | MIME Types | Future Operations |
|----------|------------|-------------------|
| `IMAGE` | jpeg, png, webp, gif, svg, bmp | compress, resize, rotate, watermark |
| `VIDEO` | mp4, webm, quicktime, avi, mpeg | transcode, thumbnail, compress |
| `DOCS` | pdf, doc, docx, xls, xlsx, txt, csv | preview, convert to PDF |
| `JSON` | application/json | parse, validate schema |
| `BINARY` | zip, rar, gz, octet-stream | raw storage |
| `OTHER` | unknown types | no special processing |

---

## Upload Options

```typescript
interface UploadOptions {
  tableName: string        // 'User', 'Company', 'CompanyDriverSetting'
  tableColumn: string      // 'avatar', 'docs', 'photos'
  tableId: string          // Entity ID (usr_xxx, cmp_xxx)
  encrypt?: boolean        // Encrypt file content
  isPublic?: boolean       // Allow public access
  allowedUserIds?: string[]    // Users who can access
  allowedCompanyIds?: string[] // Companies whose managers can access
  allowedCategories?: FileCategory[] // Restrict upload to these categories
}
```

---

## Permission Logic

### Access Control (`canUserAccessFile`)
Access is granted if ANY of these conditions is true:
1. `file.isPublic === true`
2. User is admin (`user.isAdmin`)
3. User owns the file (for User table: `file.tableId === user.id`)
4. User manages the company (for Company table: `file.tableId === user.companyId`)
5. User is in `file.allowedUserIds`
6. User manages a company in `file.allowedCompanyIds`

**SPECIAL**: For `CompanyDriverSetting` files (push-only):
- Drivers **cannot** access files after upload
- Only company managers and admins can access

### Upload Validation (`validateUploadOwnership`)
Validates ownership before upload:
- Users can only upload to their own User record
- Company managers can only upload to their managed company
- Drivers uploading to `CompanyDriverSetting` automatically grant access to the company (push-only)

### Delete/Update Permissions
- File owner (User or Company manager)
- Admin users
- Company managers for `CompanyDriverSetting` files

---

## Storage Structure

```
uploads/
└── {tableName}/           # user, company, companydiversetting
    └── {tableId}/         # usr_xxx, cmp_xxx, cds_xxx
        └── {column}_{fileId}_{timestamp}_{random}.{ext}
```

Example: `uploads/user/usr_abc123/avatar_fil_xyz789_MTc2_MC4x.png`

---

## API Routes

| Method | Route | Action |
|--------|-------|--------|
| GET | `/files/categories` | Get category info |
| POST | `/files/upload` | Upload single file |
| POST | `/files/upload-multiple` | Upload multiple files |
| GET | `/files/:fileId/download` | Download file |
| GET | `/files/:fileId/view` | View file inline |
| PUT | `/files/:fileId/permissions` | Update permissions |
| DELETE | `/files/:fileId` | Delete file |
| GET | `/files/:tableName/:tableId` | List files for entity |
| DELETE | `/files/:tableName/:tableId/all` | Delete all files for entity |
| GET | `/company/files` | List company administrative files |

**Query params for listing:** `?column=avatar` (filter by column)
