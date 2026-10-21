import type { StoreConfig } from "../lib/stores";
import { minutesToTime } from "../lib/time";
import { WEEKDAY_LABELS_VI, type WeekdayKey } from "../lib/demand";
export function DocsTab({ stores }: { stores: StoreConfig[] }) {
  return <div className="space-y-4">
    {stores.map(store => <section key={store.id} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <h2 className="font-semibold">{store.name}</h2><p>{store.address}</p><p className="text-sm">{store.notes}</p>
      <ul className="text-sm space-y-2">{(Object.keys(store.workHours!.perWeekday) as WeekdayKey[]).map(day =>
        <li key={day}>{WEEKDAY_LABELS_VI[day]}: {store.workHours!.closedWeekdays[day] ? "Nghỉ" : store.workHours!.perWeekday[day].map(b => `${minutesToTime(b.startMinutes)}–${minutesToTime(b.endMinutes)}`).join(" / ")}</li>)}</ul>
      <p className="text-sm">Ngày lễ: mở như ngày thường. Không tính Nachtzuschlag và Sonntagszuschlag.</p>
    </section>)}
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm space-y-2">
      <h2 className="font-semibold">Lương và giờ tham khảo</h2>
      <p>Giờ/tháng và Brutto theo bảng của chủ (9 người, 766,39 h, 13.090 €). Lương giờ = Brutto ÷ giờ.</p>
      <p>Vollzeit 6 giờ/ngày; Nhân viên mới B 150 h/tháng, tối đa 5 ngày/tuần. Pause 30 phút.</p>
      <p>PDF Stundenzettel: trước mỗi bảng có 1 tờ thông số; ô Gesamtstunden để trống cho chủ tự điền.</p>
    </section>
  </div>;
}
