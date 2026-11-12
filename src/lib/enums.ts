export enum PropertyStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE"
}

export enum RoomStatus {
  CLEAN = "CLEAN",
  DIRTY = "DIRTY",
  INSPECTED = "INSPECTED",
  OUT_OF_ORDER = "OUT_OF_ORDER",
  OUT_OF_SERVICE = "OUT_OF_SERVICE"
}

export enum PaymentType {
  CASH = "CASH",
  CARD = "CARD",
  TRANSFER = "TRANSFER"
}

export enum ProfileType {
  GUEST = "GUEST",
  COMPANY = "COMPANY",
  TRAVEL_AGENT = "TRAVEL_AGENT",
  STAFF = "STAFF"
}

export enum ProfileClassification {
  VIP = "VIP",
  REGULAR = "REGULAR",
  BLACKLISTED = "BLACKLISTED"
}

export enum ReservationStatus {
  // Held on option until Reservation.optionDate (Agent Portal plan A-5).
  TENTATIVE = "TENTATIVE",
  RESERVED = "RESERVED",
  IN_HOUSE = "IN_HOUSE",
  CHECKED_OUT = "CHECKED_OUT",
  NO_SHOW = "NO_SHOW",
  CANCELLED = "CANCELLED"
}
