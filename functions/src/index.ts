/* eslint-disable camelcase */
/* eslint-disable max-len */
/* eslint-disable require-jsdoc */
import {calendar_v3, google} from "googleapis";
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

interface Appointment {
  id?: string;
  google_calendar_event_id?: string;
  client_id: string;
  date: string;
  email: string;
  employee_id_list: string[];
  end_time: string;
  is_regular: boolean;
  notes: string;
  number: string;
  room_id_list: string[];
  start_time: string;
  status_id: string;
  time: string;
  total_duration: number;
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

  interface TreatmentCategory {
    name: string;
    id?: string;
  }

  interface GoogleCalendarResponse {
    status: number; // Status code
    data?: calendar_v3.Schema$Event; // Event data (optional)
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
    CREATE = "CREATE",
  }

  interface data {
    appointment: Appointment;
    appointment_id: string;
    operation: Operation;
  }

exports.googleCalendarEvent = functions.https.onRequest(async (data, context) => {
  try {
    const myData = data.body as data;
    console.log("myData", myData);
    console.log("appointment", myData.appointment);
    console.log("appointment_id", myData?.appointment_id);
    console.log("operation", myData?.operation);
    console.log("client_id", myData.appointment?.client_id);
    const credentials = await getGoogleOAuthConfig();
    const calendar = google.calendar({
      version: "v3",
      auth: new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/calendar"],
      }),
    });

    let googleResponse: GoogleCalendarResponse | undefined;

    if (myData.operation === Operation.DELETE && myData?.appointment_id) {
      const appRef = db.collection("appointments").doc(myData.appointment_id);
      const appDocSnapshot = (await appRef.get()).data() as Appointment;
      const eventId = appDocSnapshot.google_calendar_event_id;
      if (!eventId) {
        context.status(400).send({error: "Missing calendar event id"});
        return;
      }
      await deleteEvent(eventId, calendar);
      context.status(200).send("Function DELETE executed successfully.");
      return;
    } else {
      if (!myData.appointment_id) {
        context.status(400).send({error: "Missing appointmentId"});
      }

      const event = await getGoogleCalendarEventFromAppointment(myData.appointment);
      console.log("event", event);
      if (!event) {
        context.status(400).send({error: "Failed to get Google Calendar event"});
        return;
      }

      if (myData.operation === Operation.CREATE) {
        googleResponse = await createEvent(calendar, event, myData.appointment_id);
      } else if (myData.operation === Operation.UPDATE) {
        const appRef = db.collection("appointments").doc(myData.appointment_id);
        const appDocSnapshot = (await appRef.get()).data() as Appointment;
        const eventId = appDocSnapshot.google_calendar_event_id;
        if (eventId) {
          googleResponse = await editEvent(eventId, calendar, event);
        }
      }
    }

    console.log("googleResponse", googleResponse);
    if (googleResponse?.status === 200) {
      context.status(200).send("Function executed successfully.");
    } else {
      context.status(400).send("Function executed unsuccessfully.");
    }
  } catch (error) {
    console.error("Error:", error);
    context.status(500).send({error: "Internal server error"});
  }
});

async function getGoogleOAuthConfig(): Promise<Credentials> {
  const storageBucket = admin.storage().bucket();
  const file = storageBucket.file("google_calendar_config/credentials.json");

  const fileContents = await file.download();
  return JSON.parse(fileContents.toString());
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createEvent(calendar: calendar_v3.Calendar, event: calendar_v3.Schema$Event, appId: string): Promise<GoogleCalendarResponse | undefined> {
  try {
    const response = await calendar.events.insert({
      calendarId: "aetherium.esteticaaurea@gmail.com",
      requestBody: event,
      sendUpdates: "all",
    });


    if (response?.status === 200 && appId) {
      const savedEvent = response.data;
      const appRef = db.collection("appointments").doc(appId);
      await appRef.update({"google_calendar_event_id": savedEvent?.id});
      console.log("data", response.data);
      console.log("Event created with ID:", savedEvent?.id);
    }

    return response;
  } catch (err) {
    console.error("Error inserting event:", err);
    return {status: 400};
  }
}

async function editEvent(eventId: string, calendar: calendar_v3.Calendar, event: calendar_v3.Schema$Event): Promise<GoogleCalendarResponse | undefined> {
  try {
    const response = await calendar.events.update({
      calendarId: "aetherium.esteticaaurea@gmail.com",
      eventId: eventId,
      requestBody: event,
      sendUpdates: "all",
    });

    if (response?.status === 200) {
      console.log("Event updated:", response.data);
    }
    return response;
  } catch (error) {
    console.error("Error editing event:", error);
    return {status: 400};
  }
}

// Delete an event
async function deleteEvent(eventId: string, calendar: calendar_v3.Calendar) {
  try {
    await calendar.events.delete({
      calendarId: "aetherium.esteticaaurea@gmail.com",
      eventId: eventId,
      sendUpdates: "all",
    });
  } catch (error) {
    console.error("Error deleting event:", error);
  }
}

async function getGoogleCalendarEventFromAppointment(appointment: Appointment): Promise<calendar_v3.Schema$Event | undefined> {
  // nomecliente - cat_treatment - treatment_name
  const docRef = db.collection("clients").doc(appointment.client_id);
  const docSnapshot = await docRef.get();
  const client = docSnapshot.exists ? docSnapshot.data() as Client : null;
  const treatmentList = await getTreatmentList(appointment);
  const treatmentDescriptions = treatmentList.map((treat) => `${treat.treatment_category_name} ${treat.name}`);

  if (client) {
    const event: calendar_v3.Schema$Event = {
      summary: `${client.first_name} - ${client.last_name} - ${treatmentDescriptions.join(" ")}`,
      description: "",
      start: {
        dateTime: replaceMillisecondsAndUTCOffset(appointment.start_time),
        timeZone: "Europe/Rome",
      },
      end: {
        dateTime: replaceMillisecondsAndUTCOffset(appointment.end_time),
        timeZone: "Europe/Rome",
      },
      location: "Via Antonio Allegri, 39, 25124 Brescia BS",
      reminders: {
        useDefault: false,
        overrides: [
          {method: "email", minutes: 30},
          {method: "popup", minutes: 10},
        ],
      },
      visibility: "default",
      transparency: "opaque",
    };
    return event;
  }
  return undefined;
}

async function getTreatmentList(appointment: Appointment): Promise<Treatment[]> {
  const treatmentCategoryMap: Map<string, string> = await getTreatmentCateogories();
  const treatmentRef = appointment.treatment_id_list.map((id) => db.collection("treatments").doc(id));

  // Use Promise.all to fetch all treatments in parallel
  const treatmentSnapshots = await Promise.all(treatmentRef.map((ref) => ref.get()));

  // Use filter and map to simplify data processing
  const treatmentList = treatmentSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => {
        const treatment = snapshot.data() as Treatment;
        treatment.treatment_category_name = treatmentCategoryMap.get(treatment.treatment_category_id);
        return treatment;
      });

  return treatmentList;
}

function replaceMillisecondsAndUTCOffset(iso8601: string): string {
  const modifiedString = iso8601.slice(0, -5) + "+01:00";
  return modifiedString;
}

async function getTreatmentCateogories(): Promise<Map<string, string>> {
  const catMap = new Map<string, string>();
  const treatmentCategoriesSnapshot = await db.collection("treatment_categories").get();
  treatmentCategoriesSnapshot.docs.forEach((doc) => {
    const cat = doc.data() as TreatmentCategory;
    catMap.set(doc.id, cat.name);
  });
  return catMap;
}
