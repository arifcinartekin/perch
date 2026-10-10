import Foundation
import os

// Syncing the library on this phone through a chain: the Swift side of
// apps/extension/src/lib/sync/engine.ts, with the same rules.
//
// One round pulls what changed on the relay and merges it, then pushes what
// changed here. Change detection is a "shadow": for every record, the
// canonical value last agreed with the chain. Local value ≠ shadow means it
// was changed here and still has to go out, and an incoming record for that
// key is skipped, because the push that follows carries a newer clock and
// wins anyway. Read and star changes are too many to diff; they wait in the
// store's pending table.

/// Bookkeeping for the chain, kept with the library. None of it syncs.
public struct ChainSyncState: Codable, Sendable {
  /// Highest relay version applied here.
  public var cursor = 0
  /// Last clock value, so ours keeps moving forward across launches.
  public var hlc: String?
  /// "type:id" → canonical value last agreed with the chain.
  var shadow: [String: String] = [:]
  /// Read and starred for articles this phone hasn't fetched yet.
  var parked: [String: ArticleState] = [:]
  public var lastSyncAt: Double?
  public var lastError: String?
  /// The chain's devices as each describes itself, by clock node. Optional
  /// so state saved before devices were listed still loads.
  public var devices: [String: ChainDevice]?
  /// Devices forgotten here, to remove from the chain on the next round.
  var forgotten: [String]?

  public init() {}
}

/// A device in the chain, as in DeviceRecordData (packages/core/src/sync.ts).
public struct ChainDevice: Codable, Sendable, Equatable {
  public var name: String
  public var platform: String
  /// Epoch milliseconds; refreshed about twice a day while it syncs.
  public var seenAt: Double

  public init(name: String, platform: String, seenAt: Double = Date.now.timeIntervalSince1970 * 1000) {
    self.name = name
    self.platform = platform
    self.seenAt = seenAt
  }

  /// How often a device refreshes its record (DEVICE_REFRESH_MS).
  public static let refresh: Double = 12 * 60 * 60 * 1000
}

struct ArticleState: Codable, Sendable, Equatable {
  var read: Bool
  var starred: Bool
}

public struct ChainSyncResult: Sendable {
  /// Records that came from other devices.
  public var pulled = 0
  public var pushed = 0
  /// Feeds added on another device, for this phone to fetch.
  public var newFeedIds: [String] = []
}

extension LocalBackend {
  private static let chainKey = "chain"
  private static let pushBatch = 500
  private static let log = Logger(subsystem: "app.perch", category: "chain")

  public func chainState() async -> ChainSyncState {
    await store.load(Self.chainKey) ?? ChainSyncState()
  }

  private func saveChainState(_ state: ChainSyncState) async {
    await store.save(state, key: Self.chainKey)
  }

  /// Turns queueing of read and star changes on or off. `reset` starts the
  /// bookkeeping over, for joining or leaving a chain.
  public func setChain(enabled: Bool, reset: Bool) async {
    chainOn = enabled
    if reset {
      await saveChainState(ChainSyncState())
      await store.clearPending(await store.pending())
    }
  }

  /// Runs a round; a call while one is running shares it. `device` is how
  /// this phone describes itself to the chain's other devices.
  public func syncChain(
    keys: ChainKeys, client: ChainClient, node: String, device: ChainDevice? = nil
  ) async throws -> ChainSyncResult {
    if let running = chainRun { return try await running.value }
    let task = Task {
      try await self.runChainSync(keys: keys, client: client, node: node, device: device)
    }
    chainRun = task
    defer { chainRun = nil }
    return try await task.value
  }

  private func runChainSync(
    keys: ChainKeys, client: ChainClient, node: String, device: ChainDevice?
  ) async throws -> ChainSyncResult {
    var st = await chainState()
    var clock = HybridClock(node: node)
    if let last = st.hlc { clock.receive(last) }
    do {
      var result = ChainSyncResult()
      try await pull(&st, &clock, client, keys, &result)
      result.pushed = try await push(&st, &clock, client, keys, node: node, device: device)
      // Pick up anything that landed meanwhile (and our own writes, harmlessly).
      if result.pushed > 0 { try await pull(&st, &clock, client, keys, &result) }
      st.hlc = clock.now()
      st.lastSyncAt = Date.now.timeIntervalSince1970 * 1000
      st.lastError = nil
      await saveChainState(st)
      return result
    } catch {
      st.hlc = clock.now()
      st.lastError = String(describing: error)
      await saveChainState(st)
      throw error
    }
  }

  // MARK: Pull

  private func pull(
    _ st: inout ChainSyncState, _ clock: inout HybridClock, _ client: ChainClient,
    _ keys: ChainKeys, _ result: inout ChainSyncResult
  ) async throws {
    while true {
      let page = try await client.changes(since: st.cursor)
      for r in page.records { clock.receive(r.hlc) }
      let records = page.records.compactMap(keys.open)
      if records.count < page.records.count {
        Self.log.warning("\(page.records.count - records.count) chain records didn't decrypt")
      }
      if !records.isEmpty {
        result.newFeedIds += await applyRemote(records, &st)
        result.pulled += records.filter { !$0.hlc.hasSuffix("-\(clock.node)") }.count
      }
      st.cursor = page.cursor
      await saveChainState(st)
      if !page.more { return }
    }
  }

  /// Merges records from the chain. Returns the ids of feeds it added.
  private func applyRemote(_ records: [ChainSyncRecord], _ st: inout ChainSyncState) async
    -> [String]
  {
    var s = await load()
    let pending = Set(await store.pending().map { "\($0.ref.feedId):\($0.ref.id)" })
    var added: [String] = []
    var removed: [String] = []
    var states: [(String, ArticleState)] = []

    /// True when it was changed here since the last sync.
    func editedHere(_ key: String, _ local: String?) -> Bool {
      guard let shadow = st.shadow[key] else { return false }
      return shadow != local
    }

    for r in records {
      switch r.type {
      case "feed":
        let index = s.library.feeds.firstIndex { $0.id == r.id }
        if editedHere(r.key, index.map { Self.feedCanon(s.library.feeds[$0]) }) { continue }
        if r.deleted {
          if let index {
            s.library.feeds.remove(at: index)
            s.validators[r.id] = nil
            removed.append(r.id)
          }
          st.shadow[r.key] = nil
          continue
        }
        guard let d = r.data, let url = d["url"]?.string else { continue }
        let categoryId = d["categoryId"]?.string ?? uncategorizedId
        let customTitle = d["customTitle"]?.string.flatMap { $0.isEmpty ? nil : $0 }
        let addedAt = d["addedAt"]?.number ?? Date.now.timeIntervalSince1970 * 1000
        if let index {
          s.library.feeds[index].categoryId = categoryId
          s.library.feeds[index].customTitle = customTitle
          s.library.feeds[index].addedAt = addedAt
        } else {
          let title = d["title"]?.string ?? URL(string: url)?.host() ?? url
          s.library.feeds.append(
            Feed(
              id: r.id, url: url, title: title, customTitle: customTitle,
              siteUrl: d["siteUrl"]?.string, iconUrl: nil, categoryId: categoryId,
              addedAt: addedAt, lastFetchedAt: nil, lastError: nil))
          added.append(r.id)
        }
        st.shadow[r.key] = Self.feedCanon(
          url: url, customTitle: customTitle, categoryId: categoryId, addedAt: addedAt)

      case "category":
        let index = s.library.categories.firstIndex { $0.id == r.id }
        if editedHere(r.key, index.map { Self.categoryCanon(s.library.categories[$0]) }) {
          continue
        }
        if r.deleted {
          if let index { s.library.categories.remove(at: index) }
          st.shadow[r.key] = nil
          continue
        }
        guard let d = r.data, let name = d["name"]?.string else { continue }
        let category = Category(
          id: r.id, name: name, order: d["order"]?.number ?? 0,
          collapsed: d["collapsed"]?.bool ?? false)
        if let index {
          s.library.categories[index] = category
        } else {
          s.library.categories.append(category)
        }
        st.shadow[r.key] = Self.categoryCanon(category)

      case "setting":
        guard let field = SettingField(rawValue: r.id) else { continue }
        if editedHere(r.key, field.canon(s.settings)) { continue }
        let value = r.deleted ? nil : r.data?["value"]
        // A value this version can't read is left alone, and not pushed back.
        guard field.set(&s.settings, value) else { continue }
        st.shadow[r.key] = field.canon(s.settings)

      case "note":
        var notes = s.notes ?? [:]
        if editedHere(r.key, notes[r.id].flatMap(Self.noteRecord)?.canon) { continue }
        if r.deleted {
          notes[r.id] = nil
          st.shadow[r.key] = nil
        } else {
          guard let note = try? r.data?.decode(Note.self), note.id == r.id else { continue }
          notes[r.id] = note
          st.shadow[r.key] = Self.noteRecord(note)?.canon
        }
        s.notes = notes

      case "device":
        var devices = st.devices ?? [:]
        if r.deleted {
          devices[r.id] = nil
        } else if let d = r.data, let name = d["name"]?.string {
          devices[r.id] = ChainDevice(
            name: name, platform: d["platform"]?.string ?? "", seenAt: d["seenAt"]?.number ?? 0)
        }
        st.devices = devices

      case "state":
        // A change here that hasn't gone out yet wins on push.
        if pending.contains(r.id) || r.deleted { continue }
        guard let read = r.data?["read"]?.bool, let starred = r.data?["starred"]?.bool else {
          continue
        }
        states.append((r.id, ArticleState(read: read, starred: starred)))

      default:
        continue
      }
    }

    state = s
    await store.save(s, key: "local")
    for id in removed { await store.deleteArticles(feedId: id, keepStarred: true) }
    for (id, value) in states {
      if await store.article(id) != nil {
        await store.setState(id, read: value.read, starred: value.starred)
        st.parked[id] = nil
      } else {
        st.parked[id] = value
      }
    }
    return added
  }

  /// Hides a device here and removes it from the chain on the next round. It
  /// can still sync: only a new chain cuts a device off.
  public func forgetChainDevice(_ id: String) async {
    var st = await chainState()
    st.devices?[id] = nil
    st.forgotten = Array(Set((st.forgotten ?? []) + [id]))
    await saveChainState(st)
  }

  /// Takes this phone off the other devices' lists, on the way out of a chain.
  public func announceLeaving(keys: ChainKeys, client: ChainClient, node: String) async {
    let st = await chainState()
    var clock = HybridClock(node: node)
    if let last = st.hlc { clock.receive(last) }
    let record = ChainSyncRecord(type: "device", id: node, data: nil, hlc: clock.now(), deleted: true)
    if let sealed = try? keys.seal(record) { _ = try? await client.push([sealed]) }
  }

  /// Read and star changes from the chain for articles fetched since.
  func applyParkedStates() async {
    var st = await chainState()
    guard !st.parked.isEmpty else { return }
    for (id, value) in st.parked where await store.article(id) != nil {
      await store.setState(id, read: value.read, starred: value.starred)
      st.parked[id] = nil
    }
    await saveChainState(st)
  }

  // MARK: Push

  private func push(
    _ st: inout ChainSyncState, _ clock: inout HybridClock, _ client: ChainClient,
    _ keys: ChainKeys, node: String, device: ChainDevice?
  ) async throws -> Int {
    let s = await load()
    var outgoing: [(record: ChainSyncRecord, canon: String?)] = []

    // This phone keeps its own device record fresh, and removes the ones
    // forgotten here.
    var announced: ChainDevice?
    if let device {
      let known = st.devices?[node]
      if known == nil || known?.name != device.name
        || device.seenAt - (known?.seenAt ?? 0) > ChainDevice.refresh
      {
        announced = device
        let data = JSONValue.object([
          "name": .string(device.name), "platform": .string(device.platform),
          "seenAt": .number(device.seenAt),
        ])
        outgoing.append(
          (ChainSyncRecord(type: "device", id: node, data: data, hlc: clock.now()), nil))
      }
    }
    let forgotten = st.forgotten ?? []
    for id in forgotten {
      outgoing.append(
        (ChainSyncRecord(type: "device", id: id, data: nil, hlc: clock.now(), deleted: true), nil))
    }

    func diff(_ type: String, _ local: [String: (data: JSONValue, canon: String)]) {
      for (id, value) in local.sorted(by: { $0.key < $1.key })
      where st.shadow["\(type):\(id)"] != value.canon {
        outgoing.append(
          (ChainSyncRecord(type: type, id: id, data: value.data, hlc: clock.now()), value.canon))
      }
      // In the shadow but gone here: deleted on this phone.
      for key in st.shadow.keys.sorted() where key.hasPrefix("\(type):") {
        let id = String(key.dropFirst(type.count + 1))
        if local[id] == nil {
          outgoing.append(
            (ChainSyncRecord(type: type, id: id, data: nil, hlc: clock.now(), deleted: true), nil))
        }
      }
    }

    diff(
      "feed",
      Dictionary(uniqueKeysWithValues: s.library.feeds.map { ($0.id, Self.feedRecord($0)) }))
    diff(
      "category",
      Dictionary(
        uniqueKeysWithValues: s.library.categories.map { ($0.id, Self.categoryRecord($0)) }))
    diff("note", (s.notes ?? [:]).compactMapValues(Self.noteRecord))
    // Settings this phone doesn't have (or doesn't know) aren't pushed.
    var settings: [String: (data: JSONValue, canon: String)] = [:]
    for field in SettingField.allCases {
      if let value = field.value(s.settings) {
        settings[field.rawValue] = (.object(["value": value]), value.canonical)
      }
    }
    for (id, value) in settings where st.shadow["setting:\(id)"] != value.canon {
      outgoing.append(
        (ChainSyncRecord(type: "setting", id: id, data: value.data, hlc: clock.now()), value.canon))
    }

    let pending = await store.pending()
    for p in pending {
      let id = "\(p.ref.feedId):\(p.ref.id)"
      let article = await store.article(id)
      let read = article?.read ?? p.read ?? false
      let starred = article?.starred ?? p.starred ?? false
      outgoing.append(
        (
          ChainSyncRecord(
            type: "state", id: id,
            data: .object(["read": .bool(read), "starred": .bool(starred)]), hlc: clock.now()),
          nil
        ))
    }
    guard !outgoing.isEmpty else { return 0 }

    var pushed = 0
    for start in stride(from: 0, to: outgoing.count, by: Self.pushBatch) {
      let batch = Array(outgoing[start..<min(start + Self.pushBatch, outgoing.count)])
      let sealed = try batch.map { try keys.seal($0.record) }
      let res = try await client.push(sealed)
      // Every outcome settles the record: "ok" stored it, "stale" means a
      // newer write is on the relay (the pull that follows brings it in),
      // "invalid" would only fail again.
      for (i, item) in res.results.enumerated() where i < batch.count {
        let (record, canon) = batch[i]
        if item.status == "invalid" { Self.log.warning("relay refused \(record.key)") }
        pushed += 1
        guard record.type != "state" && record.type != "device" else { continue }
        st.shadow[record.key] = record.deleted ? nil : canon
      }
    }
    // Clear what went out, keeping anything that changed again meanwhile.
    let now = Set(await store.pending())
    await store.clearPending(pending.filter { now.contains($0) })
    if let announced { st.devices = (st.devices ?? [:]).merging([node: announced]) { _, new in new } }
    if !forgotten.isEmpty { st.forgotten = nil }
    return pushed
  }

  // MARK: Records

  static func feedCanon(
    url: String, customTitle: String?, categoryId: String, addedAt: Double
  ) -> String {
    JSONValue.object([
      "url": .string(url), "customTitle": customTitle.map(JSONValue.string) ?? .null,
      "categoryId": .string(categoryId), "addedAt": .number(addedAt),
    ]).canonical
  }

  static func feedCanon(_ f: Feed) -> String {
    feedCanon(
      url: f.url, customTitle: f.customTitle?.isEmpty == false ? f.customTitle : nil,
      categoryId: f.categoryId, addedAt: f.addedAt)
  }

  static func feedRecord(_ f: Feed) -> (data: JSONValue, canon: String) {
    var d: [String: JSONValue] = [
      "url": .string(f.url), "categoryId": .string(f.categoryId), "addedAt": .number(f.addedAt),
    ]
    if !f.title.isEmpty { d["title"] = .string(f.title) }
    if let t = f.customTitle, !t.isEmpty { d["customTitle"] = .string(t) }
    if let site = f.siteUrl { d["siteUrl"] = .string(site) }
    return (.object(d), feedCanon(f))
  }

  static func noteRecord(_ n: Note) -> (data: JSONValue, canon: String)? {
    guard let data = try? JSONValue(encoding: n) else { return nil }
    return (data, data.canonical)
  }

  static func categoryCanon(_ c: Category) -> String {
    categoryRecord(c).data.canonical
  }

  static func categoryRecord(_ c: Category) -> (data: JSONValue, canon: String) {
    let data = JSONValue.object([
      "name": .string(c.name), "order": .number(c.order), "collapsed": .bool(c.collapsed ?? false),
    ])
    return (data, data.canonical)
  }
}

/// The synced settings this app keeps (the extension has a couple more,
/// which the phone leaves alone).
private enum SettingField: String, CaseIterable {
  case theme, readingFont, appearance, glass

  func value(_ s: SyncedSettings) -> JSONValue? {
    switch self {
    case .theme: s.theme.flatMap { try? JSONValue(encoding: $0) }
    case .readingFont: s.readingFont.flatMap { try? JSONValue(encoding: $0) }
    case .appearance: s.appearance.flatMap { try? JSONValue(encoding: $0) }
    case .glass: s.glass.flatMap { try? JSONValue(encoding: $0) }
    }
  }

  /// Canonical form of the value as this app holds it (after a round trip
  /// through its model), or nil when unset.
  func canon(_ s: SyncedSettings) -> String? { value(s)?.canonical }

  /// Sets it from the chain's value (nil clears it). False when the value
  /// doesn't fit this app's model.
  func set(_ s: inout SyncedSettings, _ value: JSONValue?) -> Bool {
    guard let value, value != .null else {
      switch self {
      case .theme: s.theme = nil
      case .readingFont: s.readingFont = nil
      case .appearance: s.appearance = nil
      case .glass: s.glass = nil
      }
      return true
    }
    do {
      switch self {
      case .theme: s.theme = try value.decode(SyncedSettings.Theme.self)
      case .readingFont: s.readingFont = try value.decode(SyncedSettings.ReadingFont.self)
      case .appearance: s.appearance = try value.decode(Appearance.self)
      case .glass: s.glass = try value.decode(GlassSettings.self)
      }
      return true
    } catch {
      return false
    }
  }
}
