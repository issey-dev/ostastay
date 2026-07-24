// AUTO-GENERATED icon adapter — edit the mapping here, not the 100+ call sites.
// Every icon the app uses, re-exported under its former lucide name but backed by an
// mx-icons two-tone (Iconsax) component, wrapped to default `color` to `currentColor`
// so it follows the surrounding text colour and dark mode (mx-icons' own default is a
// fixed grey). A few icons with no faithful runtime two-tone match stay on lucide.
// App code imports from "@/components/icons" instead of "lucide-react".
import type { ComponentType, SVGProps } from "react"
import {
  ActivityTwotone,
  AddTwotone,
  ArrowCircleRightTwotone,
  ArrowDown2Twotone,
  ArrowLeft2Twotone,
  ArrowRight2Twotone,
  ArrowSwapHorizontalTwotone,
  ArrowUp2Twotone,
  BankTwotone,
  Box1Twotone,
  BoxTwotone,
  BriefcaseTwotone,
  BrushTwotone,
  Building3Twotone,
  CalculatorTwotone,
  Calendar1Twotone,
  CalendarTickTwotone,
  CalendarTwotone,
  CardTwotone,
  CategoryTwotone,
  Chart2Twotone,
  ClipboardTextTwotone,
  ClipboardTickTwotone,
  ClockTwotone,
  CloseCircleTwotone,
  CloseSquareTwotone,
  CloudDrizzleTwotone,
  CoffeeTwotone,
  CoinTwotone,
  ColorSwatchTwotone,
  DangerTwotone,
  DiscoverTwotone,
  Document1Twotone,
  DocumentCopyTwotone,
  DocumentTextTwotone,
  DollarSquareTwotone,
  Edit2Twotone,
  EditTwotone,
  ExportTwotone,
  EyeSlashTwotone,
  EyeTwotone,
  Forbidden2Twotone,
  Grid2Twotone,
  InfoCircleTwotone,
  HashtagTwotone,
  KeyTwotone,
  LayerTwotone,
  LocationTwotone,
  LockTwotone,
  LoginTwotone,
  LogoutTwotone,
  MagicStarTwotone,
  MapTwotone,
  Message2Twotone,
  MonitorTwotone,
  MoonTwotone,
  MoreTwotone,
  Notification1Twotone,
  NotificationBingTwotone,
  PeopleTwotone,
  PercentageSquareTwotone,
  PersonalcardTwotone,
  PrinterTwotone,
  ProfileCircleTwotone,
  ProfileRemoveTwotone,
  Receipt1Twotone,
  Receipt2Twotone,
  RecordCircleTwotone,
  Refresh2Twotone,
  ReserveTwotone,
  RotateLeftTwotone,
  Save2Twotone,
  SearchNormal1Twotone,
  Send2Twotone,
  Setting2Twotone,
  ShieldCrossTwotone,
  ShieldSlashTwotone,
  ShieldTickTwotone,
  ShieldTwotone,
  ShopTwotone,
  SidebarLeftTwotone,
  SmsTwotone,
  SortTwotone,
  Star1Twotone,
  StatusUpTwotone,
  SunTwotone,
  TaskSquareTwotone,
  TextTwotone,
  TickCircleTwotone,
  TickSquareTwotone,
  TrashTwotone,
  UnlockTwotone,
  UserAddTwotone,
  UserEditTwotone,
  UserTickTwotone,
  UserTwotone,
  Wallet2Twotone,
} from "mx-icons"
import { BedDouble, DoorOpen, Pin, PinOff, Utensils, UtensilsCrossed, Wrench } from "lucide-react"

export type IconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { size?: number | string; color?: string }
export type IconComponent = ComponentType<IconProps>

function twotone(Cmp: ComponentType<Record<string, unknown>>): IconComponent {
  const Wrapped = (props: IconProps) => <Cmp color="currentColor" {...(props as Record<string, unknown>)} />
  Wrapped.displayName = (Cmp as { displayName?: string }).displayName ?? "TwotoneIcon"
  return Wrapped
}

export const Activity = twotone(ActivityTwotone)
export const AlertTriangle = twotone(DangerTwotone)
export const ArrowLeft = twotone(ArrowLeft2Twotone)
export const ArrowLeftRight = twotone(ArrowSwapHorizontalTwotone)
export const ArrowRight = twotone(ArrowRight2Twotone)
export const ArrowRightCircle = twotone(ArrowCircleRightTwotone)
export const ArrowRightLeft = twotone(ArrowSwapHorizontalTwotone)
export const ArrowUp = twotone(ArrowUp2Twotone)
export const Ban = twotone(Forbidden2Twotone)
export const BarChart3 = twotone(Chart2Twotone)
export const Bell = twotone(Notification1Twotone)
export const BellDot = twotone(NotificationBingTwotone)
export const Boxes = twotone(Box1Twotone)
export const Briefcase = twotone(BriefcaseTwotone)
export const Brush = twotone(BrushTwotone)
export const Building2 = twotone(Building3Twotone)
export const Calculator = twotone(CalculatorTwotone)
export const Calendar = twotone(CalendarTwotone)
export const CalendarCheck = twotone(CalendarTickTwotone)
export const CalendarClock = twotone(Calendar1Twotone)
export const CalendarDays = twotone(Calendar1Twotone)
export const Check = twotone(TickSquareTwotone)
export const CheckCircle = twotone(TickCircleTwotone)
export const CheckCircle2 = twotone(TickCircleTwotone)
export const CheckIcon = twotone(TickSquareTwotone)
export const CheckSquare = twotone(TaskSquareTwotone)
export const ChevronDown = twotone(ArrowDown2Twotone)
export const ChevronDownIcon = twotone(ArrowDown2Twotone)
export const ChevronLeft = twotone(ArrowLeft2Twotone)
export const ChevronRight = twotone(ArrowRight2Twotone)
export const ChevronRightIcon = twotone(ArrowRight2Twotone)
export const ChevronUp = twotone(ArrowUp2Twotone)
export const ChevronUpIcon = twotone(ArrowUp2Twotone)
export const ChevronsUpDown = twotone(SortTwotone)
export const Circle = twotone(RecordCircleTwotone)
export const ClipboardCheck = twotone(ClipboardTickTwotone)
export const ClipboardList = twotone(ClipboardTextTwotone)
export const Clock = twotone(ClockTwotone)
export const CloudRain = twotone(CloudDrizzleTwotone)
export const Coffee = twotone(CoffeeTwotone)
export const Compass = twotone(DiscoverTwotone)
export const ConciergeBell = twotone(ReserveTwotone)
export const Contact = twotone(PersonalcardTwotone)
export const CreditCard = twotone(CardTwotone)
export const DollarSign = twotone(DollarSquareTwotone)
export const Edit = twotone(EditTwotone)
export const Edit2 = twotone(Edit2Twotone)
export const ExternalLink = twotone(ExportTwotone)
export const Eye = twotone(EyeTwotone)
export const EyeOff = twotone(EyeSlashTwotone)
export const FileBarChart = twotone(Chart2Twotone)
export const FileSpreadsheet = twotone(Document1Twotone)
export const FileStack = twotone(DocumentCopyTwotone)
export const FileText = twotone(DocumentTextTwotone)
export const FileType = twotone(DocumentTextTwotone)
export const HandCoins = twotone(CoinTwotone)
export const Hash = twotone(HashtagTwotone)
export const Info = twotone(InfoCircleTwotone)
export const History = twotone(ClockTwotone)
export const Hotel = twotone(Building3Twotone)
export const Key = twotone(KeyTwotone)
export const KeyRound = twotone(KeyTwotone)
export const Landmark = twotone(BankTwotone)
export const Layers = twotone(LayerTwotone)
export const LayoutDashboard = twotone(CategoryTwotone)
export const LayoutGrid = twotone(Grid2Twotone)
export const ListChecks = twotone(TaskSquareTwotone)
export const Loader2 = twotone(Refresh2Twotone)
export const Lock = twotone(LockTwotone)
export const LogIn = twotone(LoginTwotone)
export const LogOut = twotone(LogoutTwotone)
export const Mail = twotone(SmsTwotone)
export const Map = twotone(MapTwotone)
export const MapPin = twotone(LocationTwotone)
export const MessageSquare = twotone(Message2Twotone)
export const MonitorPlay = twotone(MonitorTwotone)
export const Moon = twotone(MoonTwotone)
export const MoreHorizontal = twotone(MoreTwotone)
export const Package = twotone(BoxTwotone)
export const Palette = twotone(ColorSwatchTwotone)
export const PanelLeftIcon = twotone(SidebarLeftTwotone)
export const Pencil = twotone(Edit2Twotone)
export const Percent = twotone(PercentageSquareTwotone)
export const Plus = twotone(AddTwotone)
export const Printer = twotone(PrinterTwotone)
export const Receipt = twotone(Receipt1Twotone)
export const ReceiptText = twotone(Receipt2Twotone)
export const RefreshCw = twotone(Refresh2Twotone)
export const RotateCcw = twotone(RotateLeftTwotone)
export const Save = twotone(Save2Twotone)
export const Search = twotone(SearchNormal1Twotone)
export const Send = twotone(Send2Twotone)
export const Settings = twotone(Setting2Twotone)
export const Settings2 = twotone(Setting2Twotone)
export const Shield = twotone(ShieldTwotone)
export const ShieldAlert = twotone(ShieldCrossTwotone)
export const ShieldCheck = twotone(ShieldTickTwotone)
export const ShieldOff = twotone(ShieldSlashTwotone)
export const Star = twotone(Star1Twotone)
export const Store = twotone(ShopTwotone)
export const Sun = twotone(SunTwotone)
export const Trash2 = twotone(TrashTwotone)
export const TrendingUp = twotone(StatusUpTwotone)
export const Type = twotone(TextTwotone)
export const Unlock = twotone(UnlockTwotone)
export const User = twotone(UserTwotone)
export const UserCheck = twotone(UserTickTwotone)
export const UserCircle = twotone(ProfileCircleTwotone)
export const UserCog = twotone(UserEditTwotone)
export const UserPlus = twotone(UserAddTwotone)
export const UserRound = twotone(UserTwotone)
export const UsersRound = twotone(PeopleTwotone)
export const UserX = twotone(ProfileRemoveTwotone)
export const Users = twotone(PeopleTwotone)
export const Wallet = twotone(Wallet2Twotone)
export const Wand2 = twotone(MagicStarTwotone)
export const X = twotone(CloseSquareTwotone)
export const XCircle = twotone(CloseCircleTwotone)
export const XIcon = twotone(CloseSquareTwotone)

// No faithful two-tone equivalent in the runtime bundle — kept as lucide.
export { BedDouble, DoorOpen, Pin, PinOff, Utensils, UtensilsCrossed, Wrench }

