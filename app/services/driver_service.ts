import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import DriverSetting from '#models/driver_setting'
import CompanyDriverSetting from '#models/company_driver_setting'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import WalletProvisioningService from '#services/wallet_provisioning_service'
import DriverRelationNotifyService from '#services/driver_relation_notify_service'

@inject()
export default class DriverService {
  /**
   * Register as driver
   */
  async register(user: User, data: { vehicleType?: string; vehiclePlate?: string }) {
    const trx = await db.transaction()
    try {
      let driverSetting = await DriverSetting.query({ client: trx })
        .where('userId', user.id)
        .first()

      if (driverSetting) {
        driverSetting.merge({
          vehicleType: data.vehicleType || driverSetting.vehicleType || 'MOTORCYCLE',
          vehiclePlate: data.vehiclePlate || driverSetting.vehiclePlate || 'PENDING',
        })
        await driverSetting.useTransaction(trx).save()
      } else {
        driverSetting = await DriverSetting.create(
          {
            userId: user.id,
            vehicleType: data.vehicleType || 'MOTORCYCLE',
            vehiclePlate: data.vehiclePlate || 'PENDING',
          },
          { client: trx }
        )
      }

      if (!user.isDriver) {
        user.isDriver = true
        await user.useTransaction(trx).save()
        await this.ensureRequiredDocuments(user, trx)
      }

      await trx.commit()
      await WalletProvisioningService.ensureUserWallet(user, { entityType: 'DRIVER' })
      return driverSetting
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }

  /**
   * Ensure all required documents exist for a driver
   */
  async ensureRequiredDocuments(user: User, trx?: any) {
    if (!user.isDriver) return

    const { REQUIRED_DRIVER_DOCUMENTS } = await import('#constants/required_documents')
    const Document = (await import('#models/document')).default
    const CompanyDriverSetting = (await import('#models/company_driver_setting')).default

    const requiredDocTypes = new Set(
      REQUIRED_DRIVER_DOCUMENTS.map((r) => r.type.replace('dct_', ''))
    )

    // Also add documents required by active companies
    const relations = await CompanyDriverSetting.query({ client: trx })
      .where('driverId', user.id)
      .whereIn('status', ['ACCESS_ACCEPTED', 'PENDING_FLEET', 'ACCEPTED'])

    for (const relation of relations) {
      if (relation.requiredDocTypes) {
        for (const docType of relation.requiredDocTypes) {
          requiredDocTypes.add(docType.replace('dct_', ''))
        }
      }
    }

    for (const typeKey of requiredDocTypes) {
      const existing = await Document.query({ client: trx })
        .where('tableName', 'User')
        .where('tableId', user.id)
        .where('documentType', typeKey)
        .first()

      if (!existing) {
        await Document.create(
          {
            tableName: 'User',
            tableId: user.id,
            documentType: typeKey,
            ownerId: user.id,
            ownerType: 'User',
            status: 'PENDING',
            isDeleted: false,
          },
          { client: trx }
        )
      }
    }
  }

  /**
   * Get driver profile
   */
  async getProfile(user: User) {
    if (!user.isDriver) throw new Error('User is not a driver')
    const profile = await DriverSetting.query()
      .where('userId', user.id)
      .preload('currentCompany')
      .preload('user')
      .firstOrFail()

    if (profile.user) {
      await profile.user.loadFiles()
    }

    return profile
  }

  /**
   * Update driver profile
   */
  async updateProfile(user: User, data: { vehicleType?: string; vehiclePlate?: string }) {
    if (!user.isDriver) throw new Error('User is not a driver')
    const driverSetting = await DriverSetting.query().where('userId', user.id).firstOrFail()
    driverSetting.merge(data)
    await driverSetting.save()
    return driverSetting
  }

  /**
   * Get my documents
   */
  async listDocuments(user: User) {
    if (!user.isDriver) throw new Error('User is not a driver')
    await this.ensureRequiredDocuments(user)
    const Document = (await import('#models/document')).default
    return await Document.query()
      .where('tableName', 'User')
      .where('tableId', user.id)
      .where('isDeleted', false)
      .preload('file')
      .orderBy('createdAt', 'desc')
  }

  /**
   * Get pending invitations
   */
  async getInvitations(user: User) {
    const relations = await CompanyDriverSetting.query()
      .where('driverId', user.id)
      .whereIn('status', ['PENDING', 'PENDING_ACCESS', 'PENDING_FLEET'])
      .preload('company')
      .preload('activeZone')
      .preload('activeVehicle')
      .preload('documents', (q: any) => {
        q.where('isDeleted', false).preload('file').orderBy('createdAt', 'asc')
      })
      .orderBy('invitedAt', 'desc')

    return await this.withAssignedSchedules(relations, user.id)
  }

  /**
   * Accept access request
   */
  async acceptAccessRequest(user: User, relationId: string) {
    const trx = await db.transaction()
    try {
      const relation = await CompanyDriverSetting.query({ client: trx })
        .where('id', relationId)
        .where('driverId', user.id)
        .where('status', 'PENDING_ACCESS')
        .forUpdate()
        .firstOrFail()

      relation.status = 'ACCESS_ACCEPTED'
      await relation.useTransaction(trx).save()

      const FileManager = (await import('#services/file_manager')).default
      const File = (await import('#models/file')).default
      const Document = (await import('#models/document')).default

      const existingFiles = await File.query({ client: trx })
        .where('tableName', 'User')
        .where('tableId', user.id)
      const manager = new FileManager(relation, 'CompanyDriverSetting')

      for (const sourceFile of existingFiles) {
        try {
          const copiedFile = await manager.cloneFileAsHardLink(sourceFile, sourceFile.tableColumn)
          const typeKey = sourceFile.tableColumn.replace('dct_', '')
          const sourceDoc = await Document.query({ client: trx })
            .where('tableName', 'User')
            .where('tableId', user.id)
            .where('documentType', typeKey)
            .first()
          let doc = await Document.query({ client: trx })
            .where('tableName', 'CompanyDriverSetting')
            .where('tableId', relation.id)
            .where('documentType', typeKey)
            .first()

          if (!doc) {
            doc = await Document.create(
              {
                tableName: 'CompanyDriverSetting',
                tableId: relation.id,
                documentType: typeKey,
                ownerId: relation.companyId,
                ownerType: 'Company',
                status: 'PENDING',
                isDeleted: false,
              },
              { client: trx }
            )
          }

          doc.fileId = copiedFile.id
          doc.status = 'PENDING'

          if (sourceDoc?.status === 'APPROVED') {
            doc.addHistory('FILE_MIRRORED', user, {
              sourceFileId: sourceFile.id,
              note: 'Ce document a été précédemment validé par Sublymus',
            })
          } else {
            doc.addHistory('FILE_MIRRORED', user, { sourceFileId: sourceFile.id })
          }
          await doc.useTransaction(trx).save()
          await manager.share(sourceFile.tableColumn, {
            read: { companyIds: [relation.companyId] },
          })
        } catch (err: any) {
          console.error(`Failed to mirror file ${sourceFile.id}:`, err.message)
        }
      }
      await trx.commit()
      await WalletProvisioningService.ensureUserWallet(user, { entityType: 'DRIVER' })
      await WalletProvisioningService.ensureCompanyDriverWallet(relation.id)
      await relation.refresh()

      await DriverRelationNotifyService.dispatch({
        scope: 'INVITATION',
        action: 'ACCESS_ACCEPTED',
        message: 'Vous avez accepte le partage de vos documents.',
        relationId: relation.id,
        driverId: relation.driverId,
        companyId: relation.companyId,
        entity: {
          status: relation.status,
        },
        push: {
          enabled: false,
        },
      })
      return relation
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }

  /**
   * Accept final fleet invitation
   */
  async acceptFleetInvitation(user: User, relationId: string) {
    const trx = await db.transaction()
    try {
      if (!user.isDriver) throw new Error('You must register as a driver first')
      const relation = await CompanyDriverSetting.query({ client: trx })
        .where('id', relationId)
        .where('driverId', user.id)
        .where('status', 'PENDING_FLEET')
        .forUpdate()
        .firstOrFail()

      relation.status = 'ACCEPTED'
      relation.acceptedAt = DateTime.now()
      await relation.useTransaction(trx).save()

      await DriverSetting.updateOrCreate(
        { userId: user.id },
        { currentCompanyId: relation.companyId },
        { client: trx }
      )

      await trx.commit()
      await WalletProvisioningService.ensureUserWallet(user, { entityType: 'DRIVER' })
      await WalletProvisioningService.ensureCompanyDriverWallet(relation.id)
      await relation.refresh()

      await DriverRelationNotifyService.dispatch({
        scope: 'INVITATION',
        action: 'FLEET_ACCEPTED',
        message: 'Vous avez rejoint la flotte.',
        relationId: relation.id,
        driverId: relation.driverId,
        companyId: relation.companyId,
        entity: {
          status: relation.status,
        },
        push: {
          enabled: false,
        },
      })
      return relation
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }

  /**
   * Reject request
   */
  async rejectRequest(user: User, relationId: string) {
    const invitation = await CompanyDriverSetting.query()
      .where('id', relationId)
      .where('driverId', user.id)
      .whereIn('status', ['PENDING_ACCESS', 'PENDING_FLEET'])
      .firstOrFail()
    invitation.status = 'REJECTED'
    await invitation.save()

    await DriverRelationNotifyService.dispatch({
      scope: 'INVITATION',
      action: 'INVITATION_REJECTED',
      message: 'Invitation refusee.',
      relationId: invitation.id,
      driverId: invitation.driverId,
      companyId: invitation.companyId,
      entity: {
        status: invitation.status,
      },
      push: {
        enabled: false,
      },
    })
    return true
  }

  /**
   * Get companies
   */
  async getCompanies(user: User) {
    const relations = await CompanyDriverSetting.query()
      .where('driverId', user.id)
      .preload('company')
      .preload('activeZone')
      .preload('activeVehicle')
      .preload('documents', (q: any) => {
        q.where('isDeleted', false).preload('file').orderBy('createdAt', 'asc')
      })
      .orderBy('createdAt', 'desc')

    return await this.withAssignedSchedules(relations, user.id)
  }

  /**
   * Upload a global document
   */
  async uploadDocument(ctx: any, user: User, docType: string) {
    const trx = await db.transaction()
    const touchedRelations: Array<{ relationId: string; companyId: string; driverId: string }> = []
    try {
      const FileManager = (await import('#services/file_manager')).default
      const manager = new FileManager(user, 'User')
      const typeKey = docType.replace('dct_', '')
      const normalizedDocType = `dct_${typeKey}`

      await manager.sync(ctx, { column: normalizedDocType, config: { encrypt: true } })

      const File = (await import('#models/file')).default
      const file = await File.query({ client: trx })
        .where('tableName', 'User')
        .where('tableId', user.id)
        .where('tableColumn', normalizedDocType)
        .orderBy('createdAt', 'desc')
        .firstOrFail()

      const Document = (await import('#models/document')).default
      let doc = await Document.query({ client: trx })
        .where('tableName', 'User')
        .where('tableId', user.id)
        .where('documentType', typeKey)
        .forUpdate()
        .first()

      if (!doc) {
        doc = await Document.create(
          {
            tableName: 'User',
            tableId: user.id,
            documentType: typeKey,
            ownerId: user.id,
            ownerType: 'User',
            status: 'PENDING',
            isDeleted: false,
          },
          { client: trx }
        )
      }

      doc.fileId = file.id
      doc.status = 'PENDING'
      doc.addHistory('FILE_UPLOADED', user, { fileId: file.id })
      await doc.useTransaction(trx).save()

      // Mirror strictly to active companies
      const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
      const relations = await CompanyDriverSetting.query({ client: trx })
        .where('driverId', user.id)
        .whereIn('status', ['ACCESS_ACCEPTED', 'PENDING_FLEET', 'ACCEPTED'])

      for (const relation of relations) {
        let relationDoc = await Document.query({ client: trx })
          .where('tableName', 'CompanyDriverSetting')
          .where('tableId', relation.id)
          .where('documentType', typeKey)
          .forUpdate()
          .first()

        if (relationDoc) {
          const relationManager = new FileManager(relation, 'CompanyDriverSetting')
          const copiedFile = await relationManager.cloneFileAsHardLink(file, normalizedDocType)

          relationDoc.fileId = copiedFile.id
          relationDoc.status = 'PENDING'
          relationDoc.addHistory('DRIVER_UPDATED_FILE', user, { sourceFileId: file.id })
          await relationDoc.useTransaction(trx).save()

          // Ensure FileData exists before sharing
          await relationManager.getFileData(normalizedDocType, relation.companyId, {
            encrypt: file.isEncrypted,
          })
          await relationManager.share(normalizedDocType, {
            read: { companyIds: [relation.companyId] },
          })

          const CompanyService = (await import('#services/company_service')).default
          const companyService = new CompanyService()
          await companyService.syncDocsStatus(relation.id, trx)
          touchedRelations.push({
            relationId: relation.id,
            companyId: relation.companyId,
            driverId: relation.driverId,
          })
        }
      }

      const VerificationService = (await import('#services/verification_service')).default
      await VerificationService.syncDriverVerificationStatus(user.id, trx)

      await trx.commit()

      for (const relation of touchedRelations) {
        await DriverRelationNotifyService.dispatch({
          scope: 'DOCUMENT',
          action: 'DOCUMENT_UPLOADED_BY_DRIVER',
          message: 'Le chauffeur a mis a jour un document.',
          relationId: relation.relationId,
          driverId: relation.driverId,
          companyId: relation.companyId,
          entity: {
            documentType: typeKey,
          },
          push: {
            enabled: false,
          },
        })
      }
      return { file, document: doc }
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }

  /**
   * Update location (tracking)
   */
  async updateLocation(userId: string, lat: number, lng: number, heading?: number) {
    const TrackingService = (await import('#services/tracking_service')).default
    await TrackingService.track(userId, lat, lng, heading)
  }

  private async withAssignedSchedules(relations: CompanyDriverSetting[], driverId: string) {
    if (!relations.length) return []

    const companyIds = Array.from(new Set(relations.map((r) => r.companyId).filter(Boolean)))
    if (!companyIds.length) {
      return relations.map((relation) => relation.serialize())
    }

    const Schedule = (await import('#models/schedule')).default
    const schedules = await Schedule.query()
      .where('ownerType', 'Company')
      .whereIn('ownerId', companyIds)
      .where('isActive', true)
      .whereHas('assignedUsers', (q) => {
        q.where('users.id', driverId)
      })
      .orderBy('priority', 'desc')
      .orderBy('startTime', 'asc')

    const Zone = (await import('#models/zone')).default
    const companyZones = await Zone.query()
      .where('ownerType', 'Company')
      .whereIn('ownerId', companyIds)
      .where('isActive', true)
      .whereHas('drivers', (q) => {
        q.where('users.id', driverId)
      })
      .orderBy('name', 'asc')

    const byCompany = new Map<string, any[]>()
    for (const schedule of schedules) {
      const ownerId = schedule.ownerId
      if (!byCompany.has(ownerId)) byCompany.set(ownerId, [])
      byCompany.get(ownerId)!.push(schedule.serialize())
    }

    const zonesByCompany = new Map<string, any[]>()
    for (const zone of companyZones) {
      const ownerId = zone.ownerId
      if (!ownerId) continue
      if (!zonesByCompany.has(ownerId)) zonesByCompany.set(ownerId, [])
      zonesByCompany.get(ownerId)!.push(zone.serialize())
    }

    return relations.map((relation) => {
      const serialized = relation.serialize() as any
      const companyAssigned = [...(zonesByCompany.get(relation.companyId) || [])]
      const activeZone = serialized.activeZone

      if (activeZone?.id && !companyAssigned.some((z: any) => z.id === activeZone.id)) {
        companyAssigned.unshift(activeZone)
      }

      return {
        ...serialized,
        assignedSchedules: byCompany.get(relation.companyId) || [],
        assignedZones: companyAssigned,
      }
    })
  }
}
