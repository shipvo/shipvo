import { device } from "../index.web";
export const Fields = { PhoneNumbers: "phoneNumbers", Emails: "emails", Name: "name" };
const st = async (s: string) => ({ status: s, granted: s === "granted", canAskAgain: s === "undetermined" });
export const getPermissionsAsync = async () => st(await device.permissions.get("contacts"));
export const requestPermissionsAsync = async () => st(await device.permissions.request("contacts"));
export const getContactsAsync = async () => {
  const data = (await device.contacts.getAll()).map((c) => ({ id: c.id, name: c.name, contactType: "person", phoneNumbers: (c.phoneNumbers ?? []).map((number) => ({ number })), emails: (c.emails ?? []).map((email) => ({ email })) }));
  return { data, hasNextPage: false, hasPreviousPage: false, total: data.length };
};
