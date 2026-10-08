import SwiftUI
import WidgetKit

@main
struct PerchWidgets: WidgetBundle {
  var body: some Widget {
    UnreadWidget()
  }
}

/// The unread count and the newest unread articles, from the snapshot the app
/// writes (WidgetSnapshot). Tapping an article opens it in the app.
struct UnreadWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetSnapshot.widgetKind, provider: Provider()) { entry in
      UnreadWidgetView(entry: entry)
    }
    .configurationDisplayName("Unread")
    .description("Your unread count and the newest articles.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .systemLarge,
      .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}

struct Entry: TimelineEntry {
  var date: Date
  /// Nil when signed out.
  var snapshot: WidgetSnapshot?
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry {
    Entry(date: .now, snapshot: .sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: .now, snapshot: context.isPreview ? .sample : WidgetSnapshot.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    // The app reloads the timeline when things change; the half-hourly
    // refresh only keeps "2 hr. ago" honest.
    let entry = Entry(date: .now, snapshot: WidgetSnapshot.load())
    completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
  }
}

extension WidgetSnapshot {
  static let sample = WidgetSnapshot(
    unread: 12,
    items: [
      .init(
        feedId: "a", articleId: "1", title: "A quiet morning with your feeds",
        feedTitle: "Perch", published: .now.addingTimeInterval(-600)),
      .init(
        feedId: "a", articleId: "2", title: "Why RSS is still the best way to read the web",
        feedTitle: "The Open Web", published: .now.addingTimeInterval(-3600)),
      .init(
        feedId: "a", articleId: "3", title: "Notes on building a self-hosted reader",
        feedTitle: "Field Notes", published: .now.addingTimeInterval(-7200)),
    ],
    accentLight: "#ff7a1a", accentDark: "#ff8f3d", updated: .now)
}

// MARK: - Views

struct UnreadWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  let entry: Entry

  var body: some View {
    Group {
      if let snapshot = entry.snapshot {
        content(snapshot)
      } else {
        signedOut
      }
    }
    .containerBackground(for: .widget) { background }
  }

  private var accent: Color {
    guard let snapshot = entry.snapshot else { return Color(hex: "#ff7a1a") }
    return Color(hex: colorScheme == .dark ? snapshot.accentDark : snapshot.accentLight)
  }

  /// The logo in the account's accent, like in the app.
  private var mark: some View {
    PerchMarkDrawing(
      colors: LogoColors(dark: colorScheme == .dark, text: .primary, accent: accent))
  }

  private var background: some View {
    ZStack {
      Color(.systemBackground)
      RadialGradient(
        colors: [accent.opacity(colorScheme == .dark ? 0.22 : 0.16), .clear],
        center: .topTrailing, startRadius: 0, endRadius: 220)
    }
  }

  @ViewBuilder
  private func content(_ snapshot: WidgetSnapshot) -> some View {
    switch family {
    case .accessoryInline:
      Text("\(snapshot.unread) unread")
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          Text(snapshot.unread, format: .number.notation(.compactName))
            .font(.title2.weight(.semibold))
            .minimumScaleFactor(0.6)
          Text("unread").font(.system(size: 9, weight: .medium))
        }
      }
      .widgetURL(WidgetSnapshot.unreadLink)
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text("\(snapshot.unread) unread").font(.headline).widgetAccentable()
        if let first = snapshot.items.first {
          Text(first.title).font(.caption).lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .widgetURL(snapshot.items.first?.link ?? WidgetSnapshot.unreadLink)
    case .systemSmall:
      small(snapshot)
    case .systemMedium:
      HStack(alignment: .top, spacing: 14) {
        count(snapshot).frame(width: 92, alignment: .leading)
        articles(snapshot, limit: 3, titleLines: 1)
      }
    default:
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .firstTextBaseline) {
          mark.frame(width: 22)
          Text("Unread").font(.headline)
          Spacer()
          Text(snapshot.unread, format: .number)
            .font(.title2.weight(.bold))
            .foregroundStyle(accent)
            .widgetAccentable()
        }
        articles(snapshot, limit: 6, titleLines: 2)
      }
    }
  }

  private func small(_ snapshot: WidgetSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      count(snapshot)
      Spacer(minLength: 0)
      if let first = snapshot.items.first {
        Text(first.title)
          .font(.footnote.weight(.medium))
          .lineLimit(3)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(snapshot.items.first?.link ?? WidgetSnapshot.unreadLink)
  }

  private func count(_ snapshot: WidgetSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      mark.frame(width: 26)
        .padding(.bottom, 4)
      Text(snapshot.unread, format: .number.notation(.compactName))
        .font(.system(size: 34, weight: .bold, design: .rounded))
        .foregroundStyle(accent)
        .minimumScaleFactor(0.5)
        .lineLimit(1)
        .widgetAccentable()
      Text("unread")
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
    }
  }

  @ViewBuilder
  private func articles(_ snapshot: WidgetSnapshot, limit: Int, titleLines: Int) -> some View {
    if snapshot.items.isEmpty {
      VStack(alignment: .leading, spacing: 4) {
        Text("All caught up").font(.subheadline.weight(.semibold))
        Text("New articles show up here.").font(.caption).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    } else {
      VStack(alignment: .leading, spacing: 9) {
        ForEach(snapshot.items.prefix(limit)) { item in
          Link(destination: item.link) {
            VStack(alignment: .leading, spacing: 1) {
              HStack(spacing: 4) {
                Text(item.feedTitle).lineLimit(1)
                Text("·")
                Text(
                  item.published,
                  format: .relative(presentation: .named, unitsStyle: .abbreviated)
                )
                .lineLimit(1)
                .fixedSize()
              }
              .font(.caption2.weight(.medium))
              .foregroundStyle(.secondary)
              Text(item.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(titleLines)
            }
          }
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var signedOut: some View {
    VStack(spacing: 8) {
      mark.frame(width: 34)
      if family != .accessoryInline {
        Text("Open Perch to add feeds")
          .font(.caption.weight(.medium))
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)
      }
    }
    .widgetURL(WidgetSnapshot.unreadLink)
  }
}

extension Color {
  /// "#rrggbb".
  init(hex: String) {
    let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
    self.init(
      .sRGB, red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255)
  }
}
