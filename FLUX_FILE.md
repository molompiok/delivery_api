# FLUX_FILE.md - Système de Gestion de Fichiers Intégré

> Documentation complète du système de fichiers avec permissions R/W centralisées.

---

## 1. Vue d'ensemble

Le système de fichiers Sublymus utilise une approche **intégrée** où les fichiers sont gérés comme des attributs d'entités (User, Vehicle, etc.) plutôt que comme des ressources indépendantes.

### Principes clés :
- **Atomicité** : Les fichiers sont créés/modifiés/supprimés en même temps que l'entité.
- **Permissions centralisées** : Un `FileData` par (tableName, tableColumn, tableId) gère les droits R/W.
- **Owner immuable** : Le créateur garde toujours ses droits, même si les listes de partage sont vidées.
- **Partage dynamique** : Les fichiers peuvent être partagés avec des users ou des companies.

---

## 2. Modèles de données

### 2.1 Table `files`

Stocke les métadonnées techniques de chaque fichier physique.

| Champ | Type | Description |
|-------|------|-------------|
| `id` | `string` | ID unique (fil_...) |
| `path` | `string` | Chemin physique sur le disque |
| `name` | `string` | Nom logique (utilisé dans les URLs) |
| `tableName` | `string` | Table liée (User, Vehicle, FileTest) |
| `tableColumn` | `string` | Colonne (avatar, identity_docs) |
| `tableId` | `string` | ID de l'entité |
| `mimeType` | `string` | Type MIME |
| `size` | `number` | Taille en bytes |
| `isEncrypted` | `boolean` | Fichier chiffré AES-256 |
| `isPublic` | `boolean` | Accès public sans auth |
| `fileCategory` | `enum` | IMAGE, VIDEO, DOCS, JSON, OTHER |

### 2.2 Table `file_data`

Centralise les permissions et la configuration pour un groupe de fichiers.

| Champ | Type | Description |
|-------|------|-------------|
| `id` | `string` | ID unique (fdt_...) |
| `tableName` | `string` | Table liée |
| `tableColumn` | `string` | Colonne |
| `tableId` | `string` | ID de l'entité |
| `ownerId` | `string` | **Immuable** - Créateur originel |
| `readAccess` | `JSON` | `{ userIds: [], companyIds: [] }` |
| `writeAccess` | `JSON` | `{ userIds: [], companyIds: [] }` |
| `config` | `JSON` | Règles de validation (voir 2.3) |

**Contrainte unique** : `(tableName, tableColumn, tableId)`

### 2.3 Structure `config`

```typescript
interface FileConfig {
    maxSize?: string       // "5MB", "10MB"
    maxFiles?: number      // 1, 5, 10
    allowedExt?: string[]  // ["pdf", "jpg", "png"]
    encrypt?: boolean      // Chiffrement AES-256
}
```

---

## 3. Logique de permissions

### 3.1 Hiérarchie (W > R)

```
canWrite(user):
  1. user.id == ownerId          → ✅ W+R (propriétaire sacré)
  2. user.id IN writeAccess.userIds    → ✅ W+R
  3. user.companyId IN writeAccess.companyIds → ✅ W+R
  4. sinon → ❌

canRead(user):
  1. canWrite(user) == true      → ✅ R (W implique R)
  2. user.id IN readAccess.userIds     → ✅ R
  3. user.companyId IN readAccess.companyIds → ✅ R
  4. File.isPublic == true       → ✅ R
  5. sinon → ❌
```

### 3.2 Règles métier

- **L'owner ne peut jamais perdre ses droits** : Son ID est stocké dans `ownerId`, pas dans les listes dynamiques.
- **W implique R** : Si un user peut écrire, il peut automatiquement lire.
- **Company = tous ses managers** : Si une company est partagée, tous les users avec `companyId` ou `currentCompanyManaged` égal à cette company ont accès.
- **Admin bypass** : Les admins (`user.isAdmin = true`) ont accès à tout.

---

## 4. Services

### 4.1 FileManager

Le cerveau du système. Instancié avec une entité et son tableName.

```typescript
const manager = new FileManager(user, 'User')
```

**Méthodes principales :**

| Méthode | Description |
|---------|-------------|
| `sync(ctx, options)` | Upload/Delete/Update fichiers depuis une requête HTTP |
| `share(column, options)` | Ajouter des IDs aux listes R/W |
| `revoke(column, options)` | Retirer des IDs des listes R/W |
| `canWrite(column, user)` | Vérifier si user peut modifier |
| `canRead(column, user)` | Vérifier si user peut lire |
| `deleteAll()` | Supprimer tous les fichiers + FileData de l'entité |
| `getFileData(column, ownerId)` | Récupérer ou créer le FileData |
| `FileManager.generateDownloadToken(filename, user)` | **(Static)** Génère un token crypté (5 min) |
| `FileManager.verifyDownloadToken(token, filename)` | **(Static)** Vérifie la validité d'un token |

**Méthode statique :**

| Méthode | Description |
|---------|-------------|
| `FileManager.checkFileAccess(file, user)` | Vérifier l'accès à un fichier spécifique |
| `FileManager.getPathsFor(tableName, tableId, column)` | Récupérer les noms de fichiers |

### 4.2 StorageController

Le "videur" qui sert les fichiers. Gère deux modes d'accès :
1. **Accès par Session** (Authorization header)
2. **Accès par Token** (Query param `?token=...`)

**Endpoints :**
- `GET /fs/:filename` : Sert le fichier physique.
- `GET /v1/fs/token/:filename` : (Authentifié) Génère un token temporaire.

**Logique de `serve` :**
1. Chercher le `File` par son nom.
2. Si `token` fourni → Valider via `FileManager.verifyDownloadToken`.
3. Si pas de token (ou invalide) → Vérifier l'auth session via `FileManager.checkFileAccess`.
4. Si accès OK → Stream le fichier (avec déchiffrement si nécessaire).

---

## 5. API Endpoints

### 5.1 Accès aux fichiers

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| `GET` | `/fs/:filename` | Optionnel* | Accéder au fichier (Public / Token / Session) |
| `GET` | `/v1/fs/token/:filename` | Requis | Obtenir un token d'accès temporaire |

*\*Note : Sans auth, le fichier doit être marqué `isPublic` ou posséder un `token` valide.*

### 5.2 Gestion (exemple FileTest)

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/v1/file-tests` | Créer entité + fichiers |
| `PUT` | `/v1/file-tests/:id` | Modifier entité + fichiers |
| `DELETE` | `/v1/file-tests/:id` | Supprimer entité + fichiers |
| `POST` | `/v1/file-tests/:id/share` | Partager fichiers |
| `POST` | `/v1/file-tests/:id/revoke` | Révoquer accès |

### 5.3 Debug

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/v1/debug/files` | Liste tous les fichiers |
| `GET` | `/v1/debug/filedata` | Liste tous les FileData |

---

## 6. Utilisation dans un contrôleur

### 6.1 Création avec fichiers

```typescript
async store(ctx: HttpContext) {
    const { request, response, auth } = ctx
    const user = auth.user!

    // 1. Créer l'entité
    const entity = await MyEntity.create({
        name: request.input('name'),
        userId: user.id
    })

    // 2. Initialiser le FileManager
    const manager = new FileManager(entity, 'MyEntity')

    // 3. Synchroniser les fichiers
    await manager.sync(ctx, { 
        column: 'avatar', 
        isPublic: true,
        config: { allowedExt: ['png', 'jpg'], maxSize: '2MB', maxFiles: 1 }
    })

    await manager.sync(ctx, { 
        column: 'documents', 
        isPublic: false,
        config: { allowedExt: ['pdf'], maxSize: '10MB', maxFiles: 5, encrypt: true }
    })

    return response.created(entity)
}
```

### 6.2 Modification avec fichiers

```typescript
async update(ctx: HttpContext) {
    const { params, request, response } = ctx
    const entity = await MyEntity.findOrFail(params.id)

    // Modifier les champs
    entity.name = request.input('name') || entity.name
    await entity.save()

    // Synchroniser les fichiers (géré automatiquement)
    const manager = new FileManager(entity, 'MyEntity')
    await manager.sync(ctx, { column: 'avatar', isPublic: true })
    await manager.sync(ctx, { column: 'documents', isPublic: false })

    return response.ok(entity)
}
```

### 6.3 Partage dynamique

```typescript
async shareDocuments(ctx: HttpContext) {
    const { params, request, response } = ctx
    const entity = await MyEntity.findOrFail(params.id)
    const manager = new FileManager(entity, 'MyEntity')

    // Partager en lecture avec une company
    await manager.share('documents', {
        read: { companyIds: [request.input('company_id')] }
    })

    // Partager en écriture avec un user
    await manager.share('documents', {
        write: { userIds: [request.input('collaborator_id')] }
    })

    return response.ok({ message: 'Shared successfully' })
}
```

### 6.4 Révocation

```typescript
async revokeAccess(ctx: HttpContext) {
    const { params, request, response } = ctx
    const entity = await MyEntity.findOrFail(params.id)
    const manager = new FileManager(entity, 'MyEntity')

    await manager.revoke('documents', {
        read: { companyIds: [request.input('company_id')] }
    })

    return response.ok({ message: 'Access revoked' })
}
```

---

## 7. Format des requêtes HTTP

### 7.1 Upload (multipart/form-data)

```bash
# Upload simple
curl -X POST /v1/entity \
  -F "name=Mon Entité" \
  -F "avatar=@photo.jpg"

# Upload multiple
curl -X POST /v1/entity \
  -F "documents[]=@doc1.pdf" \
  -F "documents[]=@doc2.pdf"
```

### 7.2 Actions sur fichiers existants (PUT)

```bash
# Ajouter des fichiers
curl -X PUT /v1/entity/:id \
  -F "documents[]=@nouveau.pdf"

# Supprimer un fichier spécifique
curl -X PUT /v1/entity/:id \
  -F "documents_delete=fil_abc123"

# Remplacer un fichier (atomic)
curl -X PUT /v1/entity/:id \
  -F "avatar_update_id=fil_abc123" \
  -F "avatar=@nouvelle_photo.jpg"
```

### 7.3 Partage (JSON)

```bash
# Partager en lecture
curl -X POST /v1/entity/:id/share \
  -H "Content-Type: application/json" \
  -d '{
    "column": "documents",
    "read_user_ids": ["usr_xxx"],
    "read_company_ids": ["cmp_yyy"]
  }'

# Partager en écriture
curl -X POST /v1/entity/:id/share \
  -H "Content-Type: application/json" \
  -d '{
    "column": "documents",
    "write_user_ids": ["usr_xxx"]
  }'
```

---

## 8. Computed Properties (Modèle)

Pour exposer les chemins de fichiers dans le JSON de l'entité :

```typescript
import { computed } from '@adonisjs/lucid/orm'
import FileManager from '#services/file_manager'

export default class MyEntity extends BaseModel {
    @computed()
    get avatar() {
        return (this.$extras.avatar || []).map((name: string) => `fs/${name}`)
    }

    @computed()
    get documents() {
        return (this.$extras.documents || []).map((name: string) => `fs/${name}`)
    }

    async loadFiles() {
        this.$extras.avatar = await FileManager.getPathsFor('MyEntity', this.id, 'avatar')
        this.$extras.documents = await FileManager.getPathsFor('MyEntity', this.id, 'documents')
    }
}
```

---

## 9. Stockage physique

### 9.1 Structure des dossiers

```
uploads/
├── user/
│   └── usr_abc123/
│       ├── avatar_user_usr_abc123_fil_xyz.jpg
│       └── identity_docs_user_usr_abc123_fil_def.pdf
├── vehicle/
│   └── vhc_456/
│       └── photos_vehicle_vhc_456_fil_ghi.png
└── filetest/
    └── tst_789/
        └── avatar_filetest_tst_789_fil_jkl.bin
```

### 9.2 Convention de nommage

```
{column}_{tableName}_{entityId}_{fileId}.{ext}
```

Exemple : `identity_docs_user_usr_abc123_fil_xyz789.pdf`

---

## 10. Sécurité

### 10.1 Chiffrement

Les fichiers marqués `encrypt: true` sont chiffrés avec AES-256 via `@adonisjs/core/services/encryption`.

```typescript
// Chiffrement à l'upload
content = Buffer.from(encryption.encrypt(content.toString('base64')))

// Déchiffrement à la lecture (dans FileService.readFile)
const decrypted = encryption.decrypt(content.toString())
```

### 10.2 Validation

La configuration `config` dans FileData permet de valider :
- **Extension** : Seules les extensions autorisées sont acceptées
- **Taille** : Limite de taille par fichier
- **Nombre** : Limite de fichiers par colonne

*Note : La validation n'est pas encore implémentée dans `sync()`. À ajouter selon les besoins.*

---

## 11. Cache (À implémenter)

Pour optimiser les performances, le `FileData` devrait être mis en cache Redis :

```typescript
// Pseudo-code
async getFileData(column, ownerId) {
    const cacheKey = `filedata:${tableName}:${column}:${tableId}`
    
    let fileData = await redis.get(cacheKey)
    if (fileData) return JSON.parse(fileData)
    
    fileData = await FileData.getOrCreate(...)
    await redis.set(cacheKey, JSON.stringify(fileData), 'EX', 3600)
    
    return fileData
}
```

---

## 12. Migration depuis l'ancien système

L'ancien `FileService` reste disponible pour la rétrocompatibilité. Le nouveau `FileManager` peut coexister.

**Différences clés :**

| Aspect | Ancien (FileService) | Nouveau (FileManager) |
|--------|---------------------|----------------------|
| Permissions | Dans la table `files` | Dans `file_data` |
| Upload | Endpoint `/files/upload` séparé | Intégré dans les entités |
| Owner | `allowedUserIds` dynamique | `ownerId` immuable |
| Partage | Via `updatePermissions()` | Via `share()`/`revoke()` |

---

## 13. Fichiers concernés

| Fichier | Description |
|---------|-------------|
| `app/models/file.ts` | Modèle File (métadonnées fichier) |
| `app/models/file_data.ts` | Modèle FileData (permissions) |
| `app/services/file_manager.ts` | Service principal |
| `app/controllers/storage_controller.ts` | Serveur de fichiers |
| `start/routes/core.ts` | Route `/v1/fs/:filename` |

---

## 14. Accès sécurisé (Signed URLs)

Pour les fichiers privés qui doivent être ouverts dans un nouvel onglet (ex: PDFs, images), l'utilisateur ne peut pas envoyer de header `Authorization` via `window.open()`.

### Flux de visualisation recommandé :

1. **Frontend** : Appelle `GET /v1/fs/token/:filename` avec son token Bearer habituel.
2. **Backend** : Vérifie les permissions et renvoie un `token` crypté (validité 5 min).
3. **Frontend** : Ouvre l'URL signée : `GET /fs/:filename?token=[TOKEN]`.
4. **Backend** : Valide le token et sert le fichier.

### Sécurité du Token :
Le token est auto-suffisant et contient le nom du fichier et la date d'expiration. Il est crypté par le serveur et ne peut pas être falsifié par le client.

---

*Dernière mise à jour : 22 janvier 2026*
