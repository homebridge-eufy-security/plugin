import { LucideAngularModule } from 'lucide-angular';
import {
  SlidersHorizontal, RefreshCw, Download, Bug, Video, VideoOff, Shield,
  ShieldOff, Eye, EyeOff, ChevronLeft, Square, SquarePlus, SquareMinus,
  TriangleAlert, Info, ShieldAlert
} from 'lucide-angular';

export function getIconsModule() {
  return LucideAngularModule.pick({
    SlidersHorizontal, RefreshCw, Download, Bug, Video, VideoOff, Shield,
    ShieldOff, Eye, EyeOff, ChevronLeft, Square, SquarePlus, SquareMinus,
    TriangleAlert, Info, ShieldAlert
  });
}