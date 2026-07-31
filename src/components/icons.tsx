// AUTO-GENERATED icon adapter — edit the mapping here, not the 100+ call sites.
// Every icon the app uses, re-exported under its former lucide name but backed by an
// mx-icons outline (Iconsax) component, wrapped to default `color` to `currentColor`
// so it follows the surrounding text colour and dark mode (mx-icons' own default is a
// fixed grey). A few icons with no faithful runtime outline match stay on lucide.
// App code imports from "@/components/icons" instead of "lucide-react".
import type { ComponentType, SVGProps } from "react"
import {
  ActivityOutline,
  AddOutline,
  ArrowCircleRightOutline,
  ArrowDown2Outline,
  ArrowLeft2Outline,
  ArrowRight2Outline,
  ArrowSwapHorizontalOutline,
  ArrowUp2Outline,
  BankOutline,
  Box1Outline,
  BoxOutline,
  BriefcaseOutline,
  BrushOutline,
  Building3Outline,
  CalculatorOutline,
  Calendar1Outline,
  CalendarTickOutline,
  CalendarRemoveOutline,
  CalendarOutline,
  CardOutline,
  CategoryOutline,
  Chart2Outline,
  ClipboardTextOutline,
  ClipboardTickOutline,
  ClockOutline,
  CloseCircleOutline,
  CloseSquareOutline,
  CloudDrizzleOutline,
  CoffeeOutline,
  CoinOutline,
  ColorSwatchOutline,
  DangerOutline,
  DiscoverOutline,
  Document1Outline,
  DocumentCopyOutline,
  DocumentTextOutline,
  DollarSquareOutline,
  Edit2Outline,
  EditOutline,
  ExportOutline,
  EyeSlashOutline,
  EyeOutline,
  Forbidden2Outline,
  Grid2Outline,
  InfoCircleOutline,
  HashtagOutline,
  KeyOutline,
  LayerOutline,
  LocationOutline,
  LockOutline,
  LoginOutline,
  LogoutOutline,
  MagicStarOutline,
  MapOutline,
  Message2Outline,
  MonitorOutline,
  MoonOutline,
  MoreOutline,
  Notification1Outline,
  NotificationBingOutline,
  PeopleOutline,
  PercentageSquareOutline,
  PersonalcardOutline,
  PrinterOutline,
  ProfileCircleOutline,
  ProfileRemoveOutline,
  Receipt1Outline,
  Receipt2Outline,
  RecordCircleOutline,
  Refresh2Outline,
  ReserveOutline,
  RotateLeftOutline,
  Save2Outline,
  SearchNormal1Outline,
  Send2Outline,
  Setting2Outline,
  ShieldCrossOutline,
  ShieldSlashOutline,
  ShieldTickOutline,
  ShieldOutline,
  ShopOutline,
  SidebarLeftOutline,
  SmsOutline,
  SortOutline,
  Star1Outline,
  StatusUpOutline,
  SunOutline,
  TaskSquareOutline,
  TextOutline,
  TickCircleOutline,
  TickSquareOutline,
  TrashOutline,
  UnlockOutline,
  UserAddOutline,
  UserEditOutline,
  UserTickOutline,
  UserOutline,
  Wallet2Outline,
} from "mx-icons"
import { BedDouble, DoorOpen, Pin, PinOff, Utensils, UtensilsCrossed, Wrench } from "lucide-react"

export type IconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { size?: number | string; color?: string }
export type IconComponent = ComponentType<IconProps>

function outline(Cmp: ComponentType<Record<string, unknown>>): IconComponent {
  const Wrapped = (props: IconProps) => <Cmp color="currentColor" {...(props as Record<string, unknown>)} />
  Wrapped.displayName = (Cmp as { displayName?: string }).displayName ?? "OutlineIcon"
  return Wrapped
}

export const Activity = outline(ActivityOutline)
export const AlertTriangle = outline(DangerOutline)
export const ArrowLeft = outline(ArrowLeft2Outline)
export const ArrowLeftRight = outline(ArrowSwapHorizontalOutline)
export const ArrowRight = outline(ArrowRight2Outline)
export const ArrowRightCircle = outline(ArrowCircleRightOutline)
export const ArrowRightLeft = outline(ArrowSwapHorizontalOutline)
export const ArrowUp = outline(ArrowUp2Outline)
export const Ban = outline(Forbidden2Outline)
export const BarChart3 = outline(Chart2Outline)
export const Bell = outline(Notification1Outline)
export const BellDot = outline(NotificationBingOutline)
export const Boxes = outline(Box1Outline)
export const Briefcase = outline(BriefcaseOutline)
export const Brush = outline(BrushOutline)
export const Building2 = outline(Building3Outline)
export const Calculator = outline(CalculatorOutline)
export const Calendar = outline(CalendarOutline)
export const CalendarCheck = outline(CalendarTickOutline)
export const CalendarClock = outline(Calendar1Outline)
export const CalendarDays = outline(Calendar1Outline)
export const CalendarOff = outline(CalendarRemoveOutline)
export const Check = outline(TickSquareOutline)
export const CheckCircle = outline(TickCircleOutline)
export const CheckCircle2 = outline(TickCircleOutline)
export const CheckIcon = outline(TickSquareOutline)
export const CheckSquare = outline(TaskSquareOutline)
export const ChevronDown = outline(ArrowDown2Outline)
export const ChevronDownIcon = outline(ArrowDown2Outline)
export const ChevronLeft = outline(ArrowLeft2Outline)
export const ChevronRight = outline(ArrowRight2Outline)
export const ChevronRightIcon = outline(ArrowRight2Outline)
export const ChevronUp = outline(ArrowUp2Outline)
export const ChevronUpIcon = outline(ArrowUp2Outline)
export const ChevronsUpDown = outline(SortOutline)
export const Circle = outline(RecordCircleOutline)
export const ClipboardCheck = outline(ClipboardTickOutline)
export const ClipboardList = outline(ClipboardTextOutline)
export const Clock = outline(ClockOutline)
export const CloudRain = outline(CloudDrizzleOutline)
export const Coffee = outline(CoffeeOutline)
export const Compass = outline(DiscoverOutline)
export const ConciergeBell = outline(ReserveOutline)
export const Contact = outline(PersonalcardOutline)
export const CreditCard = outline(CardOutline)
export const DollarSign = outline(DollarSquareOutline)
export const Edit = outline(EditOutline)
export const Edit2 = outline(Edit2Outline)
export const ExternalLink = outline(ExportOutline)
export const Eye = outline(EyeOutline)
export const EyeOff = outline(EyeSlashOutline)
export const FileBarChart = outline(Chart2Outline)
export const FileSpreadsheet = outline(Document1Outline)
export const FileStack = outline(DocumentCopyOutline)
export const FileText = outline(DocumentTextOutline)
export const FileType = outline(DocumentTextOutline)
export const HandCoins = outline(CoinOutline)
export const Hash = outline(HashtagOutline)
export const Info = outline(InfoCircleOutline)
export const History = outline(ClockOutline)
export const Hotel = outline(Building3Outline)
export const Key = outline(KeyOutline)
export const KeyRound = outline(KeyOutline)
export const Landmark = outline(BankOutline)
export const Layers = outline(LayerOutline)
export const LayoutDashboard = outline(CategoryOutline)
export const LayoutGrid = outline(Grid2Outline)
export const ListChecks = outline(TaskSquareOutline)
export const Loader2 = outline(Refresh2Outline)
export const Lock = outline(LockOutline)
export const LogIn = outline(LoginOutline)
export const LogOut = outline(LogoutOutline)
export const Mail = outline(SmsOutline)
export const Map = outline(MapOutline)
export const MapPin = outline(LocationOutline)
export const MessageSquare = outline(Message2Outline)
export const MonitorPlay = outline(MonitorOutline)
export const Moon = outline(MoonOutline)
export const MoreHorizontal = outline(MoreOutline)
export const Package = outline(BoxOutline)
export const Palette = outline(ColorSwatchOutline)
export const PanelLeftIcon = outline(SidebarLeftOutline)
export const Pencil = outline(Edit2Outline)
export const Percent = outline(PercentageSquareOutline)
export const Plus = outline(AddOutline)
export const Printer = outline(PrinterOutline)
export const Receipt = outline(Receipt1Outline)
export const ReceiptText = outline(Receipt2Outline)
export const RefreshCw = outline(Refresh2Outline)
export const RotateCcw = outline(RotateLeftOutline)
export const Save = outline(Save2Outline)
export const Search = outline(SearchNormal1Outline)
export const Send = outline(Send2Outline)
export const Settings = outline(Setting2Outline)
export const Settings2 = outline(Setting2Outline)
export const Shield = outline(ShieldOutline)
export const Sparkles = outline(MagicStarOutline)
export const ShieldAlert = outline(ShieldCrossOutline)
export const ShieldCheck = outline(ShieldTickOutline)
export const ShieldOff = outline(ShieldSlashOutline)
export const Star = outline(Star1Outline)
export const Store = outline(ShopOutline)
export const Sun = outline(SunOutline)
export const Trash2 = outline(TrashOutline)
export const TrendingUp = outline(StatusUpOutline)
export const Type = outline(TextOutline)
export const Unlock = outline(UnlockOutline)
export const User = outline(UserOutline)
export const UserCheck = outline(UserTickOutline)
export const UserCircle = outline(ProfileCircleOutline)
export const UserCog = outline(UserEditOutline)
export const UserPlus = outline(UserAddOutline)
export const UserRound = outline(UserOutline)
export const UsersRound = outline(PeopleOutline)
export const UserX = outline(ProfileRemoveOutline)
export const Users = outline(PeopleOutline)
export const Wallet = outline(Wallet2Outline)
export const Wand2 = outline(MagicStarOutline)
export const X = outline(CloseSquareOutline)
export const XCircle = outline(CloseCircleOutline)
export const XIcon = outline(CloseSquareOutline)

// No faithful outline equivalent in the runtime bundle — kept as lucide.
export { BedDouble, DoorOpen, Pin, PinOff, Utensils, UtensilsCrossed, Wrench }

