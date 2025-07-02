import {google, calendar_v3 as CalendarV3} from "googleapis";
import {onRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import moment from "moment-timezone";

admin.initializeApp();
const db = admin.firestore();

interface Appointment {
  id: string;
  google_calendar_event_id?: string;
  client_id: string;
  date: string;
  email: string;
  employee_id_list: string[];
  end_time: string;
  is_regular: boolean;
  from_google_calendar: boolean;
  notes: string;
  number: string;
  room_id_list: string[];
  start_time: string;
  status_id: string;
  time: string;
  total_duration: number;
  color_id: string;
  treatment_id_list: string[];
}

interface Credentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

interface Treatment {
  id: string;
  duration: number;
  is_employee_required: boolean;
  room_id_list: string[];
  name: string;
  treatment_category_name?: string;
  treatment_category_id: string;
}

interface GoogleCalendarResponse {
  status: number;
  data?: CalendarV3.Schema$Event | {error: string};
}

interface Client {
  address: string;
  birthday: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number: string;
}

enum Operation {
  UPDATE = "UPDATE",
  DELETE = "DELETE",
  CREATE = "CREATE"
}

interface RequestData {
  appointment: Appointment;
  appointment_id: string;
  operation: Operation;
}

exports.googleCalendarEvent = onRequest(async (req, res) => {
  console.log(
    "NEW VERSION - googleCalendarEvent running - " +
    new Date().toLocaleString("it-IT", {timeZone: "Europe/Rome"})
  );
  try {
    console.log("Raw req.body:", JSON.stringify(req.body, null, 2));
    const data = req.body as RequestData;
    console.log("Parsed RequestData:", JSON.stringify(data, null, 2));

    if (!data["appointment_id"]) {
      console.error("Missing appointment_id in data:", JSON.stringify(data, null, 2));
      res.status(400).send({error: "Missing appointment_id"});
      return;
    }

    const credentials = await getGoogleOAuthConfig();
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const calendar = google.calendar({version: "v3", auth});

    if (data.operation === Operation.DELETE) {
      await handleDeleteOperation(data["appointment_id"], calendar, res);
    } else {
      const event = await getGoogleCalendarEvent(data.appointment, data["appointment_id"]);
      console.log("Generated Google Calendar Event CREATE:", JSON.stringify(event, null, 2));

      if (!event) {
        console.error("Failed to generate Google Calendar Event");
        res.status(400).send({error: "Failed to generate Google Calendar event"});
        return;
      }

      console.log("Final event object being sent to Google API:", JSON.stringify(event, null, 2));

      if (data.operation === Operation.CREATE) {
        const response = await createEvent(calendar, event, data["appointment_id"]);
        sendResponse(res, response);
      }

      if (data.operation === Operation.UPDATE) {
        const response = await updateEvent(calendar, data["appointment_id"], event);
        sendResponse(res, response);
      }
    }
  } catch (error) {
    console.error("Unhandled error in googleCalendarEvent:", error);
    res.status(500).send({error: "Internal server error"});
  }
});

async function getGoogleOAuthConfig(): Promise<Credentials> {
  const file = admin.storage().bucket().file("google_calendar_config/credentials.json");
  const [fileContents] = await file.download();
  return JSON.parse(fileContents.toString());
}

async function handleDeleteOperation(
  appointmentId: string,
  calendar: CalendarV3.Calendar,
  res: any
): Promise<void> {
  const appDoc = await db.collection("appointments").doc(appointmentId).get();
  const eventId = appDoc.data()?.google_calendar_event_id;
  if (!eventId) {
    console.error("Missing google_calendar_event_id in appointment doc:", appDoc.data());
    res.status(400).send({error: "Missing calendar event id"});
    return;
  }
  await deleteEvent(eventId, calendar);
  res.status(200).send("Event deleted successfully.");
}

async function createEvent(
  calendar: CalendarV3.Calendar,
  event: CalendarV3.Schema$Event,
  appointmentId: string
): Promise<GoogleCalendarResponse> {
  try {
    const response = await calendar.events.insert({
      calendarId: "davideromano5991@gmail.com",
      requestBody: event,
      sendUpdates: "all",
    });

    if (response?.status === 200 && response.data.id) {
      await db.collection("appointments").doc(appointmentId).update({
        google_calendar_event_id: response.data.id,
      });
      console.log("Event created with ID:", response.data.id);
    }

    return {status: response.status || 400, data: response.data};
  } catch (error: any) {
    const googleError = error.response?.data?.error?.message || error.message || JSON.stringify(error);
    console.error("Google Calendar API error:", googleError);
    return {status: 400, data: {error: googleError}};
  }
}

async function updateEvent(
  calendar: CalendarV3.Calendar,
  appointmentId: string,
  event: CalendarV3.Schema$Event
): Promise<GoogleCalendarResponse> {
  const appDoc = await db.collection("appointments").doc(appointmentId).get();
  const eventId = appDoc.data()?.google_calendar_event_id;

  if (!eventId) {
    console.error("No calendar event ID found for update.");
    return {status: 400, data: {error: "Missing google_calendar_event_id"}};
  }

  try {
    const response = await calendar.events.update({
      calendarId: "davideromano5991@gmail.com",
      eventId,
      requestBody: event,
      sendUpdates: "all",
    });
    console.log("Event updated:", JSON.stringify(response.data, null, 2));
    return {status: response.status || 400, data: response.data};
  } catch (error: any) {
    const googleError = error.response?.data?.error?.message || error.message || JSON.stringify(error);
    console.error("Google Calendar API error (update):", googleError);
    return {status: 400, data: {error: googleError}};
  }
}

async function deleteEvent(eventId: string, calendar: CalendarV3.Calendar): Promise<void> {
  try {
    await calendar.events.delete({
      calendarId: "davideromano5991@gmail.com",
      eventId,
      sendUpdates: "all",
    });
    console.log("Event deleted:", eventId);
  } catch (error) {
    console.error("Error deleting event:", error);
  }
}

function formatGoogleDateTime(dateTime: string): string {
  const m = moment.tz(dateTime, "YYYY-MM-DD HH:mm:ss.SSS", "Europe/Rome");
  if (!m.isValid()) {
    console.error(`Invalid datetime passed to formatGoogleDateTime: ${dateTime}`);
    throw new Error(`Invalid datetime: ${dateTime}`);
  }
  return m.tz("Europe/Rome").format();
}

async function getGoogleCalendarEvent(
  appointment: Appointment,
  appointmentId: string
): Promise<CalendarV3.Schema$Event | undefined> {
  console.log("appointmentId", appointmentId);

  const clientSnap = await db.collection("clients").doc(appointment["client_id"]).get();
  const client = clientSnap.exists ? (clientSnap.data() as Client) : null;

  if (!client) {
    console.warn("Client not found:", appointment["client_id"]);
    throw new Error("Client is empty or undefined");
  }

  if (!client.first_name || !client.last_name) {
    console.error("Client first_name or last_name is missing:", client);
    throw new Error("Missing client first_name or last_name");
  }

  const treatments = await getTreatmentList(appointment);
  const treatmentSummary = treatments.map((t) => `${t.treatment_category_name} ${t.name}`).join(", ");
  const firstName = client.first_name ?? "";
  const lastName = client.last_name ?? "";
  const summary = `${firstName} ${lastName} - ${treatmentSummary}`.trim();

  if (!summary) {
    throw new Error("Generated summary is empty");
  }

  console.log("Generated treatment summary:", treatmentSummary);
  console.log("appointment.id for extendedProperties:", appointmentId);

  let colorId: string | undefined = undefined;

  try {
    if (appointment.color_id) {
      const colorDoc = await db.collection("colors").doc(appointment.color_id).get();
      if (colorDoc.exists) {
        const colorData = colorDoc.data();
        colorId = String(colorData?.color_id); // convert to string for Google Calendar
      } else {
        console.warn(`Color document not found: ${appointment.color_id}`);
      }
    }
  } catch (error) {
    console.error(`Error fetching color_id for ${appointment.color_id}:`, error);
  }

  return {
    summary: summary,
    description: summary,
    start: {
      dateTime: formatGoogleDateTime(appointment["start_time"]),
      timeZone: "Europe/Rome",
    },
    end: {
      dateTime: formatGoogleDateTime(appointment["end_time"]),
      timeZone: "Europe/Rome",
    },
    extendedProperties: {
      private: {
        appointment_id: appointmentId,
      },
    },
    location: "Via Antonio Allegri, 39, 25124 Brescia BS",
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 30 },
        { method: "popup", minutes: 10 },
      ],
    },
    visibility: "default",
    colorId: colorId ?? "5", // fallback to default colorId if not found
    transparency: "opaque",
  };
}

async function getTreatmentList(appointment: Appointment): Promise<Treatment[]> {
  const categoryMap = await getTreatmentCategories();
  const treatmentRefs = appointment["treatment_id_list"].map((id) =>
    db.collection("treatments").doc(id)
  );
  const treatmentSnaps = await Promise.all(treatmentRefs.map((ref) => ref.get()));

  return treatmentSnaps
    .filter((snap) => snap.exists)
    .map((snap) => {
      const treatment = snap.data() as Treatment;
      treatment["treatment_category_name"] =
        categoryMap.get(treatment["treatment_category_id"]) || "Unknown";
      return treatment;
    });
}

async function getTreatmentCategories(): Promise<Map<string, string>> {
  const snapshot = await db.collection("treatment_categories").get();
  const map = new Map<string, string>();
  snapshot.forEach((doc) => map.set(doc.id, doc.data().name));
  return map;
}

function sendResponse(res: any, response: GoogleCalendarResponse): void {
  console.log("Google response object:", JSON.stringify(response, null, 2));
  if (response.status === 200) {
    res.status(200).send("Operation completed successfully.");
  } else {
    if ("error" in (response.data ?? {})) {
      console.error("Returning error to client:", (response.data as { error: string }).error);
      res.status(400).send({error: (response.data as { error: string }).error});
    } else {
      console.error("Returning generic failure to client");
      res.status(400).send({error: "Operation failed."});
    }
  }
}
