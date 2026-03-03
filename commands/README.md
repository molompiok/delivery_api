# 🛠️ AdonisJS Ace Commands - Sublymus Delivery API

Bienvenue dans le répertoire des commandes CLI (Ace commands) de l'API Delivery.

Afin de maintenir le projet propre, cohérent et organisé de manière intelligente, **ce dossier suit une architecture stricte.** Que vous soyez un développeur humain ou un Agent IA, vous devez impérativement vous conformer à ces règles avant de créer, modifier ou supprimer un test/script.

---

## 📂 Architecture des Dossiers

### 1. `/commands/tests` - Tests de Validation Finaux (End-To-End)
Ce répertoire contient les **tests complets de scénarios métier (E2E)** construits au fil du développement. 
- **Objectif :** Valider qu'une fonctionnalité complexe marche toujours et n'a pas été fracturée par de nouvelles modifications.
- **Règle fondamentale :** Tous les tests ici **DOIVENT** être conditionnés dans un bloc `Transaction` stérile (ils annulent les modifications avec `.rollback()` à la toute fin de leur exécution). Aucune donnée ne doit fuiter dans la base de données réelle.
- **Maintenance :** Ils doivent être mis à jour si l'architecture sous-jacente change.

### 2. `/commands/debug` - Les Scripts Éphémères
Dossier jetable. Utilisez ce répertoire pour créer une commande de debug rapide (vérifier un bug en BDD, explorer la valeur d'un wallet, tester l'envoi d'un mail...).
- **Règle :** À SUPPRIMER IMMÉDIATEMENT APRÈS USAGE. **Aucun script ne doit stagner ici à long terme.**

### 3. `/commands/real_impact` - Modifications Réelles (PATCH / SEED)
Ce dossier est l'exception à la règle du `.rollback()`. Il contient les scripts qui ont un **véritable impact permanent sur la base de données de production/staging**.
- Exemples : Scripts de migration complexes (`PATCH_001_fix_wallets.ts`), corrections de données existantes après un bug, ou routines de backfill de base de données.
- Seeders asynchrones massifs (si les seeders standard de Lucid ne suffisent pas).

### 4. `/commands` (Racine) - Workers et Moteurs
La racine est réservée uniquement au fonctionnement vital de l'architecture backend asynchrone (Les fameux "Background Workers").
- Exemples typiques : `assignment_worker.ts`, `shift_check.ts`.

---

## 🏗️ Règles d'Ingénierie pour les Scripts et Tests

### 1. Toujours utiliser les Services, jamais les Controllers
Nos tests (`/commands/tests/`) **NE DOIVENT PAS** appeler ou simuler de requêtes HTTP vers les Controllers. 
Les Controllers ne sont que de simples passe-plats qui transmettent les données (sans logique). Vous devez injecter et tester directement les **Services** (ex: `OrderDraftService`, `MissionService`, `BookingService`).

### 2. Le Modèle Master `effectiveTrx`
Dans ce projet, tous les appels de méthodes de Services (`createOrder`, `acceptMission`, etc.) doivent **obligatoirement** exposer en dernier paramètre une option permettant d'insérer un `TransactionClientContract` (`trx`).

Pour gérer intelligemment l'imbrication des transactions, et permettre à nos commandes de test de passer une transaction parente qui sera *rollback* à la fin, chaque service doit implémenter le pattern `effectiveTrx` en première ligne de ses méthodes :

```typescript
// Exemple dans un Service : Model `effectiveTrx`
async maMethodeService(donnee: n'importe quoi, trx?: TransactionClientContract) {
    // Règle d'or : On utilise le trx parent s'il est fourni (par notre test par exemple), 
    // Sinon, on initie notre propre transaction locale (comportement normal via l'API).
    const effectiveTrx = trx || await db.transaction()
    
    try {
        // ... Logique métier utilisant "effectiveTrx" et PAS "trx" ...
        const user = await User.create({ name: 'Bob' }, { client: effectiveTrx })
        
        // On NE COMMIT PAS si on roule sur une transaction parente ! On laisse le parent gérer.
        if (!trx) await effectiveTrx.commit() 
        return user;
        
    } catch (error) {
        // De même, on ne rollback pas si on est sur la transaction du parent. 
        // Le throw fera remonter l'erreur, et c'est le grand parent qui fera le rollback global.
        if (!trx) await effectiveTrx.rollback()
        throw error
    }
}
```

**Pourquoi ce modèle est-t-il crucial ?**
Les commandes dans `/commands/tests/` vont créer un `const mainTrx = await db.transaction()` au début de leur exécution. Ce `mainTrx` est ensuite passé en cascade à chaque appel de méthode service simulé. Ainsi, le service ne fera aucun petit sous-commit isolé. À la toute fin du test, la commande executera simplement `await mainTrx.rollback()`, détruisant proprement toutes les traces d'un scénario massif.
