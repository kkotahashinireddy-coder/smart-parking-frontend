
import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080/api";

function getToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function App() {
  const [locations, setLocations] = useState([]);
  const [slots, setSlots] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [vehicleType, setVehicleType] = useState("CAR");
  const [evRequired, setEvRequired] = useState(false);
  const [accessibleRequired, setAccessibleRequired] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [demand, setDemand] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    customerName: "",
    vehicleNumber: "",
    slotId: "",
    startTime: "10:00",
    endTime: "12:00",
    date: getToday(),
  });

  // Common function for calling the Spring Boot backend.
  const request = useCallback(async (path, options = {}) => {
    let response;

    try {
      response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          ...(options.body
            ? { "Content-Type": "application/json" }
            : {}),
          ...options.headers,
        },
      });
    } catch {
      throw new Error(
        "Cannot connect to Spring Boot. Make sure it is running on port 8080."
      );
    }

    const text = await response.text();
    let data = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
          data.detail ||
          data.error ||
          `Request failed with status ${response.status}`
      );
    }

    return data;
  }, []);

  // Load parking locations.
  const loadLocations = useCallback(async () => {
    try {
      const data = await request("/locations");
      const list = Array.isArray(data) ? data : [];

      setLocations(list);

      setSelectedLocation((current) => {
        if (current && list.some((item) => String(item.id) === current)) {
          return current;
        }
        return list.length ? String(list[0].id) : "";
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  // Load slots for the selected location.
  const loadSlots = useCallback(async () => {
    if (!selectedLocation) {
      setSlots([]);
      return;
    }

    try {
      const data = await request(
        `/locations/${selectedLocation}/slots`
      );
      setSlots(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    }
  }, [request, selectedLocation]);

  // Load bookings.
  const loadBookings = useCallback(async () => {
    const data = await request("/bookings");
    setBookings(Array.isArray(data) ? data : []);
  }, [request]);

  // Load demand insight.
  const loadDemand = useCallback(async () => {
    if (!selectedLocation) {
      setDemand("");
      return;
    }

    try {
      const data = await request(
        `/ai/demand?locationId=${selectedLocation}`
      );
      setDemand(data.summary || "No demand information returned.");
    } catch {
      setDemand("Demand insight unavailable.");
    }
  }, [request, selectedLocation]);

  // Load recommendations using vehicle, EV and accessibility requirements.
  const loadRecommendations = useCallback(async () => {
    if (!selectedLocation) {
      setRecommendations([]);
      return;
    }

    try {
      const query = new URLSearchParams({
        locationId: selectedLocation,
        vehicleType,
        evRequired: String(evRequired),
        accessibleRequired: String(accessibleRequired),
      });

      const data = await request(
        `/ai/recommend?${query.toString()}`
      );

      setRecommendations(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    }
  }, [
    request,
    selectedLocation,
    vehicleType,
    evRequired,
    accessibleRequired,
  ]);

  useEffect(() => {
    loadLocations();
    loadBookings().catch((err) => setError(err.message));
  }, [loadLocations, loadBookings]);

  useEffect(() => {
    loadSlots();
    loadDemand();
    loadRecommendations();
  }, [loadSlots, loadDemand, loadRecommendations]);

  // Refresh bookings and related information.
  const refreshBookings = async () => {
    if (refreshing) return;

    setRefreshing(true);
    setError("");
    setMessage("");

    try {
      await Promise.all([
        loadBookings(),
        loadSlots(),
        loadDemand(),
        loadRecommendations(),
      ]);

      setMessage("Booking information refreshed successfully.");
    } catch (err) {
      setError(`Refresh failed: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const updateForm = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const chooseSlot = (slot) => {
    setForm((current) => ({
      ...current,
      slotId: String(slot.id),
    }));

    document.getElementById("booking-form")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  // Create a booking.
  const createBooking = async (event) => {
    event.preventDefault();

    if (submitting) return;

    setMessage("");
    setError("");

    if (!selectedLocation || !form.slotId) {
      setError(
        "Please select a location and an available parking slot."
      );
      return;
    }

    const start = new Date(
      `${form.date}T${form.startTime}:00`
    );
    const end = new Date(
      `${form.date}T${form.endTime}:00`
    );

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      setError("Please enter a valid booking date and time.");
      return;
    }

    if (start.getTime() < Date.now() - 60_000) {
      setError("Please choose a booking start time in the future.");
      return;
    }

    if (end <= start) {
      setError("End time must be after start time.");
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        customerName: form.customerName.trim(),
        vehicleNumber: form.vehicleNumber.trim().toUpperCase(),
        locationId: Number(selectedLocation),
        slotId: Number(form.slotId),
        startTime: `${form.date}T${form.startTime}:00`,
        endTime: `${form.date}T${form.endTime}:00`,
        vehicleType,
        evRequired,
        accessibleRequired,
      };

      const booking = await request("/bookings", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setMessage(
        `Booking #${booking.id} created successfully. ` +
          `Estimated fee: ₹${booking.estimatedFee}.`
      );

      setForm((current) => ({
        ...current,
        customerName: "",
        vehicleNumber: "",
        slotId: "",
      }));

      await Promise.all([
        loadBookings(),
        loadSlots(),
        loadDemand(),
        loadRecommendations(),
      ]);

      document.getElementById("bookings")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (err) {
      setError(`Booking failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle check-in and check-out.
  const updateBookingStatus = async (id, action) => {
    if (actionLoadingId !== null) return;

    setMessage("");
    setError("");
    setActionLoadingId(id);

    try {
      const result = await request(
        `/bookings/${id}/${action}`,
        { method: "POST" }
      );

      setMessage(
        `Booking #${result.id} updated successfully. ` +
          `Status: ${result.status}.`
      );

      await Promise.all([
        loadBookings(),
        loadSlots(),
        loadDemand(),
        loadRecommendations(),
      ]);
    } catch (err) {
      const reason =
        err.message || "Unable to update booking status.";

      if (
        action === "check-in" &&
        reason.toLowerCase().includes("before the booking start time")
      ) {
        setError(
          `Booking #${id}: Check-in is not open yet. ` +
            "You can check in at or after the scheduled start time."
        );
      } else if (
        action === "check-in" &&
        reason.includes("BOOKED reservation")
      ) {
        setError(
          `Booking #${id} is no longer in BOOKED status. ` +
            "Refresh the booking list to see its current status."
        );
      } else if (
        action === "check-out" &&
        reason.includes("CHECKED_IN")
      ) {
        setError(
          `Booking #${id} must be checked in before checkout.`
        );
      } else {
        setError(reason);
      }

      try {
        await loadBookings();
        await loadSlots();
      } catch {
        // Keep the original error message visible.
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const location = locations.find(
    (item) => String(item.id) === selectedLocation
  );

  const availableCount = slots.filter(
    (slot) => !slot.occupied
  ).length;

  const occupiedCount = slots.filter(
    (slot) => slot.occupied
  ).length;

  // A slot must match every selected requirement.
  const matchingSlots = slots.filter(
    (slot) =>
      !slot.occupied &&
      slot.vehicleType === vehicleType &&
      (!evRequired || slot.evCharging) &&
      (!accessibleRequired || slot.accessible)
  );

  // Do not enable check-in before its scheduled start time.
  const canCheckIn = (booking) => {
    if (booking.status !== "BOOKED" || !booking.startTime) {
      return false;
    }

    const start = new Date(booking.startTime);

    return (
      !Number.isNaN(start.getTime()) &&
      Date.now() >= start.getTime()
    );
  };

  const money = (amount) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount ?? 0);

  if (loading) {
    return (
      <div className="loading-screen">
        Loading Smart Parking…
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#dashboard" className="brand">
          <span className="brand-icon">P</span>
          <span>
            <strong>Smart Parking</strong>
            <small>Park smarter, live better</small>
          </span>
        </a>

        <nav className="nav-links">
          <a className="nav-link active" href="#dashboard">
            ⌂ <span>Dashboard</span>
          </a>
          <a className="nav-link" href="#booking-form">
            ＋ <span>Book Parking</span>
          </a>
          <a className="nav-link" href="#bookings">
            ▤ <span>My Bookings</span>
          </a>
          <a className="nav-link" href="#locations">
            ⌖ <span>Parking Locations</span>
          </a>
          <a className="nav-link" href="#insights">
            ✧ <span>AI Demand Insights</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="parking-art">🚘</div>
          <strong>Smart Parking</strong>
          <span>For a smarter city</span>
        </div>
      </aside>

      <main id="dashboard" className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">YOUR PARKING, SIMPLIFIED</p>
            <h1>Welcome to Smart Parking!</h1>
            <p className="muted">
              Find, book and manage your parking slots easily.
            </p>
          </div>

          <div className="user-pill">
            <span>U</span> Your Dashboard
          </div>
        </header>

        {error && (
          <div className="alert error-alert" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>×</button>
          </div>
        )}

        {message && (
          <div className="alert success-alert" role="status">
            <span>{message}</span>
            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}

        <section className="stats-grid">
          <Stat
            icon="⌖"
            label="Total Locations"
            value={locations.length}
            color="blue"
          />

          <Stat
            icon="▦"
            label="Total Slots"
            value={locations.reduce(
              (sum, item) => sum + Number(item.totalSlots || 0),
              0
            )}
            color="green"
          />

          <Stat
            icon="🚘"
            label="Available Slots"
            value={availableCount}
            color="purple"
          />

          <Stat
            icon="%"
            label="Occupied Slots"
            value={occupiedCount}
            color="orange"
          />
        </section>

        <div className="content-grid">
          <div className="left-column">
            <section id="locations" className="panel">
              <div className="section-heading">
                <div>
                  <h2>Parking Locations</h2>
                  <p className="muted">
                    Choose a location to explore its available slots.
                  </p>
                </div>
                <span className="live-tag"><i /> Live data</span>
              </div>

              {locations.length === 0 ? (
                <p>No locations found. Check your backend data.</p>
              ) : (
                <div className="location-grid">
                  {locations.map((item, index) => (
                    <button
                      type="button"
                      className={`location-card ${
                        String(item.id) === selectedLocation
                          ? "selected"
                          : ""
                      }`}
                      key={item.id}
                      onClick={() => {
                        setSelectedLocation(String(item.id));
                        setForm((current) => ({
                          ...current,
                          slotId: "",
                        }));
                      }}
                    >
                      <div
                        className={`location-illustration illustration-${index % 2}`}
                      >
                        <span>
                          {index % 2 === 0 ? "🏢" : "🏙️"}
                        </span>
                        <small>
                          {index % 2 === 0
                            ? "CITY PARKING"
                            : "URBAN PARKING"}
                        </small>
                      </div>

                      <div className="location-info">
                        <h3>{item.name}</h3>
                        <p>⌖ {item.address}</p>

                        <div className="location-footer">
                          <strong>
                            {money(item.hourlyRate)} <small>/ hour</small>
                          </strong>

                          <span className="availability-pill">
                            {String(item.id) === selectedLocation
                              ? `${availableCount} available`
                              : `${item.totalSlots} total slots`}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="panel" id="recommendations">
              <div className="section-heading">
                <div>
                  <h2>✧ Recommended Slots</h2>
                  <p className="muted">
                    Find a spot matching your vehicle and preferences.
                  </p>
                </div>
              </div>

              <div className="filter-row">
                <label>
                  Vehicle type
                  <select
                    value={vehicleType}
                    onChange={(event) => {
                      setVehicleType(event.target.value);
                      setForm((current) => ({
                        ...current,
                        slotId: "",
                      }));
                    }}
                  >
                    <option value="CAR">Car</option>
                    <option value="BIKE">Bike</option>
                    <option value="SUV">SUV</option>
                    <option value="EV">EV</option>
                  </select>
                </label>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={evRequired}
                    onChange={(event) => {
                      setEvRequired(event.target.checked);
                      setForm((current) => ({
                        ...current,
                        slotId: "",
                      }));
                    }}
                  />
                  EV charging required
                </label>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={accessibleRequired}
                    onChange={(event) => {
                      setAccessibleRequired(event.target.checked);
                      setForm((current) => ({
                        ...current,
                        slotId: "",
                      }));
                    }}
                  />
                  Accessible parking required
                </label>
              </div>

              {recommendations.length === 0 ? (
                <div className="empty-state">
                  <span>⌖</span>
                  <strong>No matching slots found</strong>
                  <p>
                    Try another vehicle type or change your requirements.
                  </p>
                </div>
              ) : (
                <div className="slot-grid">
                  {recommendations.map((slot) => (
                    <button
                      type="button"
                      key={slot.id}
                      className={`slot-card ${
                        String(form.slotId) === String(slot.id)
                          ? "chosen"
                          : ""
                      }`}
                      onClick={() => chooseSlot(slot)}
                    >
                      <span className="slot-icon">P</span>

                      <span>
                        <strong>{slot.slotCode}</strong>
                        <small>
                          {slot.evCharging
                            ? "⚡ EV charging"
                            : slot.vehicleType}
                          {slot.accessible ? " · Accessible" : ""}
                        </small>
                      </span>

                      <span className="slot-free">Available</span>
                    </button>
                  ))}
                </div>
              )}

              <p className="hint">
                Select a recommended slot to add it to your booking.
              </p>
            </section>

            <section id="bookings" className="panel">
              <div className="section-heading">
                <div>
                  <h2>Recent Bookings</h2>
                  <p className="muted">
                    Bookings retrieved from your backend.
                  </p>
                </div>

                <button
                  type="button"
                  className="text-button"
                  onClick={refreshBookings}
                  disabled={refreshing}
                >
                  {refreshing ? "Refreshing..." : "Refresh ↻"}
                </button>
              </div>

              {bookings.length === 0 ? (
                <p className="muted">
                  No bookings yet. Create your first booking above.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Customer / Vehicle</th>
                        <th>Slot / Start time</th>
                        <th>Status</th>
                        <th>Fee</th>
                        <th>Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {bookings.map((booking) => {
                        const busy = actionLoadingId === booking.id;
                        const eligibleForCheckIn = canCheckIn(booking);

                        return (
                          <tr key={booking.id}>
                            <td>#{booking.id}</td>

                            <td>
                              <strong>{booking.customerName}</strong>
                              <small className="table-subtitle">
                                {booking.vehicleNumber} ·{" "}
                                {booking.slot?.vehicleType ||
                                  booking.vehicleType ||
                                  "Vehicle"}
                              </small>
                            </td>

                            <td>
                              <strong>
                                {booking.slot?.slotCode || "—"}
                              </strong>
                              <small className="table-subtitle">
                                Starts: {formatDateTime(booking.startTime)}
                              </small>
                            </td>

                            <td>
                              <span
                                className={`status status-${String(
                                  booking.status
                                ).toLowerCase()}`}
                              >
                                {booking.status}
                              </span>
                            </td>

                            <td>{money(booking.estimatedFee)}</td>

                            <td>
                              {booking.status === "BOOKED" &&
                                eligibleForCheckIn && (
                                  <button
                                    type="button"
                                    className="mini-button"
                                    disabled={
                                      busy || actionLoadingId !== null
                                    }
                                    onClick={() =>
                                      updateBookingStatus(
                                        booking.id,
                                        "check-in"
                                      )
                                    }
                                  >
                                    {busy ? "Checking in..." : "Check in"}
                                  </button>
                                )}

                              {booking.status === "BOOKED" &&
                                !eligibleForCheckIn && (
                                  <button
                                    type="button"
                                    className="mini-button"
                                    disabled
                                    title="Check-in opens at the scheduled start time."
                                  >
                                    Check-in later
                                  </button>
                                )}

                              {booking.status === "CHECKED_IN" && (
                                <button
                                  type="button"
                                  className="mini-button"
                                  disabled={
                                    busy || actionLoadingId !== null
                                  }
                                  onClick={() =>
                                    updateBookingStatus(
                                      booking.id,
                                      "check-out"
                                    )
                                  }
                                >
                                  {busy ? "Checking out..." : "Check out"}
                                </button>
                              )}

                              {booking.status === "COMPLETED" && (
                                <span className="muted">Completed</span>
                              )}

                              {booking.status === "CANCELLED" && (
                                <span className="muted">Cancelled</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="right-column">
            <section id="insights" className="panel demand-panel">
              <div className="demand-heading">
                <span className="brain-icon">✧</span>
                <div>
                  <h2>AI Parking Demand</h2>
                  <p>Live insights from your backend</p>
                </div>
              </div>

              <div className="demand-meter">
                <div className="meter-number">
                  {slots.length
                    ? Math.round(
                        (occupiedCount / slots.length) * 100
                      )
                    : 0}
                  %
                </div>
                <span>Occupancy</span>
              </div>

              <div className="demand-summary">
                <span className="check-icon">✓</span>
                <div>
                  <strong>Current demand</strong>
                  <p>{demand || "Loading demand insight…"}</p>
                </div>
              </div>

              <button
                type="button"
                className="outline-button full-width"
                onClick={loadDemand}
              >
                Refresh demand ↻
              </button>
            </section>

            <section id="booking-form" className="panel booking-panel">
              <div className="section-heading">
                <div>
                  <h2>▣ Book Your Slot</h2>
                  <p className="muted">
                    Reserve your parking space.
                  </p>
                </div>
              </div>

              <form onSubmit={createBooking}>
                <label>
                  Customer name
                  <input
                    name="customerName"
                    value={form.customerName}
                    onChange={updateForm}
                    placeholder="Enter your name"
                    required
                  />
                </label>

                <label>
                  Vehicle number
                  <input
                    name="vehicleNumber"
                    value={form.vehicleNumber}
                    onChange={updateForm}
                    placeholder="e.g. TS09AB1234"
                    required
                  />
                </label>

                <label>
                  Location
                  <select
                    value={selectedLocation}
                    onChange={(event) => {
                      setSelectedLocation(event.target.value);
                      setForm((current) => ({
                        ...current,
                        slotId: "",
                      }));
                    }}
                    required
                  >
                    {locations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Parking slot
                  <select
                    name="slotId"
                    value={form.slotId}
                    onChange={updateForm}
                    required
                  >
                    <option value="">
                      Select an available slot
                    </option>

                    {matchingSlots.map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {slot.slotCode}
                        {slot.evCharging ? " · EV charging" : ""}
                        {slot.accessible ? " · Accessible" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Date
                  <input
                    type="date"
                    name="date"
                    min={getToday()}
                    value={form.date}
                    onChange={updateForm}
                    required
                  />
                </label>

                <div className="time-row">
                  <label>
                    Start time
                    <input
                      type="time"
                      name="startTime"
                      value={form.startTime}
                      onChange={updateForm}
                      required
                    />
                  </label>

                  <label>
                    End time
                    <input
                      type="time"
                      name="endTime"
                      value={form.endTime}
                      onChange={updateForm}
                      required
                    />
                  </label>
                </div>

                <div className="estimated-fee">
                  <span>Hourly rate</span>
                  <strong>{money(location?.hourlyRate)} / hour</strong>
                </div>

                <button
                  className="primary-button full-width"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting
                    ? "Creating booking..."
                    : "＋ Create Booking"}
                </button>
              </form>
            </section>

            <section className="tip-card">
              <span className="tip-icon">✧</span>
              <div>
                <h3>Let AI find your spot!</h3>
                <p>
                  Choose your vehicle preferences to get matching
                  parking recommendations.
                </p>
                <a href="#recommendations">
                  Explore recommendations →
                </a>
              </div>
            </section>
          </div>
        </div>

        <footer>
          Smart Parking · Connected to your Spring Boot API
        </footer>
      </main>
    </div>
  );
}

function Stat({ icon, label, value, color }) {
  return (
    <div className="stat-card">
      <span className={`stat-icon ${color}`}>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export default App;