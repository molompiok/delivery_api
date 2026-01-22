# Programme de Test FileManager v2 (avec FileData)

Ce guide teste le nouveau système de gestion de fichiers avec permissions R/W centralisées.

---

## Variables d'environnement

```bash
BASE_URL="http://localhost:3333/v1"
TOKEN=""
TEST_ID=""
OTHER_USER_ID=""
COMPANY_ID=""
```

---

## ÉTAPE 1 : Authentification

### 1.1 Envoyer OTP
```bash
curl -s -X POST $BASE_URL/auth/phone/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone": "+22507070707"}'
```

### 1.2 Vérifier OTP (récupérer le code de la réponse précédente)
```bash
curl -s -X POST $BASE_URL/auth/phone/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+22507070707", "otp": "CODE_ICI"}'
```
**Récupérer le TOKEN de la réponse et le stocker.**

---

## ÉTAPE 2 : Création avec fichiers (POST)

```bash
curl -s -X POST $BASE_URL/file-tests \
  -H "Authorization: Bearer $TOKEN" \
  -F "name=Test FileData" \
  -F "avatar=@test_assets/avatar.png" \
  -F "identity_docs[]=@test_assets/doc.pdf"
```
**Récupérer le `id` (tst_...) de la réponse et le stocker dans TEST_ID.**

---

## ÉTAPE 3 : Lecture (GET)

### 3.1 Voir l'entité
```bash
curl -s -X GET $BASE_URL/file-tests/$TEST_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 3.2 Accès fichier PUBLIC (avatar)
```bash
# Récupérer le nom du fichier avatar de la réponse précédente
AVATAR_NAME="avatar_filetest_..."
curl -i -X GET $BASE_URL/fs/$AVATAR_NAME
```
**Résultat attendu : 200 OK (fichier public)**

### 3.3 Accès fichier PRIVÉ sans token
```bash
DOC_NAME="identity_docs_filetest_..."
curl -i -X GET $BASE_URL/fs/$DOC_NAME
```
**Résultat attendu : 403 Forbidden**

### 3.4 Accès fichier PRIVÉ avec token (Owner)
```bash
curl -i -X GET $BASE_URL/fs/$DOC_NAME \
  -H "Authorization: Bearer $TOKEN"
```
**Résultat attendu : 200 OK (owner a accès)**

---

## ÉTAPE 4 : Modification champs seuls (PUT)

```bash
curl -s -X PUT $BASE_URL/file-tests/$TEST_ID \
  -H "Authorization: Bearer $TOKEN" \
  -F "name=Nom Modifié" \
  -F "description=Description ajoutée"
```

---

## ÉTAPE 5 : Ajout de fichiers (PUT)

```bash
curl -s -X PUT $BASE_URL/file-tests/$TEST_ID \
  -H "Authorization: Bearer $TOKEN" \
  -F "identity_docs[]=@test_assets/avatar.png"
```

---

## ÉTAPE 6 : Suppression ciblée (PUT)

```bash
# Récupérer l'ID d'un fichier identity_docs (fil_...)
FILE_ID="fil_..."
curl -s -X PUT $BASE_URL/file-tests/$TEST_ID \
  -H "Authorization: Bearer $TOKEN" \
  -F "identity_docs_delete=$FILE_ID"
```

---

## ÉTAPE 7 : Remplacement atomique (PUT)

```bash
# Récupérer l'ID de l'avatar actuel
OLD_AVATAR_ID="fil_..."
curl -s -X PUT $BASE_URL/file-tests/$TEST_ID \
  -H "Authorization: Bearer $TOKEN" \
  -F "avatar_update_id=$OLD_AVATAR_ID" \
  -F "avatar=@test_assets/avatar.png"
```

---

## ÉTAPE 8 : Partage dynamique

### 8.1 Partager en lecture avec un autre utilisateur
```bash
OTHER_USER_ID="usr_..."
curl -s -X POST $BASE_URL/file-tests/$TEST_ID/share \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "column": "identity_docs",
    "read_user_ids": ["'$OTHER_USER_ID'"]
  }'
```

### 8.2 Partager en écriture avec une company
```bash
COMPANY_ID="cmp_..."
curl -s -X POST $BASE_URL/file-tests/$TEST_ID/share \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "column": "identity_docs",
    "write_company_ids": ["'$COMPANY_ID'"]
  }'
```

### 8.3 Vérifier l'accès avec l'autre utilisateur
```bash
# S'authentifier avec l'autre utilisateur et récupérer son token
OTHER_TOKEN="..."
curl -i -X GET $BASE_URL/fs/$DOC_NAME \
  -H "Authorization: Bearer $OTHER_TOKEN"
```
**Résultat attendu : 200 OK (partagé en R)**

---

## ÉTAPE 9 : Révocation des droits

### 9.1 Révoquer l'accès lecture
```bash
curl -s -X POST $BASE_URL/file-tests/$TEST_ID/revoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "column": "identity_docs",
    "read_user_ids": ["'$OTHER_USER_ID'"]
  }'
```

### 9.2 Vérifier que l'accès est révoqué
```bash
curl -i -X GET $BASE_URL/fs/$DOC_NAME \
  -H "Authorization: Bearer $OTHER_TOKEN"
```
**Résultat attendu : 403 Forbidden**

---

## ÉTAPE 10 : Suppression complète (DELETE)

```bash
curl -i -X DELETE $BASE_URL/file-tests/$TEST_ID \
  -H "Authorization: Bearer $TOKEN"
```
**Résultat attendu : 204 No Content**
**Vérification : Le dossier uploads/filetest/$TEST_ID doit être supprimé.**

---

## Debug : Voir tous les FileData

```bash
curl -s -X GET $BASE_URL/debug/files \
  -H "Authorization: Bearer $TOKEN"
```
