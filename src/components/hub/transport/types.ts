// DTOs of GET /api/transport/config — shared by the Hub setup screens and the desk's
// booking/manifest forms.

export type Ref = { id: string; code?: string; name?: string }

export type TransportTypeDto = {
  id: string
  code: string
  name: string
  mode: string
  requiresFlightDetails: boolean
  isActive: boolean
}

export type TransportLocationDto = {
  id: string
  code: string
  name: string
  type: string
  notes: string | null
  isActive: boolean
}

export type TransportRouteDto = {
  id: string
  code: string
  name: string
  originId: string
  destinationId: string
  transportTypeId: string
  origin: { id: string; code: string; name: string; type: string }
  destination: { id: string; code: string; name: string; type: string }
  transportType: { id: string; code: string; name: string; mode: string; requiresFlightDetails: boolean }
  category: string
  direction: string
  durationMinutes: number | null
  instructions: string | null
  departureSlots: string[]
  isActive: boolean
}

export type TransportVesselDto = {
  id: string
  providerId: string
  name: string
  transportTypeId: string | null
  transportType?: { id: string; code: string; name: string } | null
  provider?: { id: string; name: string; kind: string }
  capacity: number
  registration: string | null
  isActive: boolean
}

export type TransportProviderDto = {
  id: string
  name: string
  kind: string
  contactName: string | null
  phone: string | null
  email: string | null
  notes: string | null
  isActive: boolean
  vessels: TransportVesselDto[]
}

export type TransportRateDto = {
  id: string
  routeId: string
  transportTypeId: string | null
  providerId: string | null
  name: string | null
  direction: string
  pricingBasis: string
  price: number
  adultPrice: number
  childPrice: number
  infantPrice: number
  childMinAge: number
  childMaxAge: number
  validFrom: string | null
  validTo: string | null
  chargeCodeId: string
  taxMode: string
  taxProfileId: string | null
  isBillable: boolean
  isActive: boolean
  route: { id: string; code: string; name: string }
  transportType: { id: string; code: string; name: string } | null
  provider: { id: string; name: string } | null
  chargeCode: { id: string; code: string; description: string }
  taxProfile: { id: string; name: string } | null
}

export type TransportSettingsDto = {
  enabled: boolean
  defaultTaxMode: string
  defaultTaxProfileId: string | null
  defaultChargeCodeId: string | null
  requireProvider: boolean
  attentionToleranceMinutes: number
}

export type ChargeCodeDto = {
  id: string
  code: string
  description: string
  postingType?: string | null
  isActive?: boolean | null
  chargeSubgroup?: {
    code?: string | null
    name?: string | null
    sortOrder?: number | null
    chargeGroup?: { code?: string | null; name?: string | null; reportBucket?: string | null; sortOrder?: number | null } | null
  } | null
}

export type TransportConfig = {
  settings: TransportSettingsDto
  types: TransportTypeDto[]
  locations: TransportLocationDto[]
  routes: TransportRouteDto[]
  providers: TransportProviderDto[]
  vessels: TransportVesselDto[]
  rates: TransportRateDto[]
  chargeCodes: ChargeCodeDto[]
  taxProfiles: { id: string; name: string }[]
}

export const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`)
