import { Model, model } from "mongoose";
import { Companies, Customers } from ".";
import {
  IImportHistoryDocument,
  importHistorySchema
} from "./definitions/importHistory";
import { IUserDocument } from "./definitions/users";

interface IImportHistoryInput {
  success?: number;
  failed?: number;
  total?: number;
  ids?: string[];
  contentType: string;
}

interface IImportHistoryModel extends Model<IImportHistoryDocument> {
  createHistory(
    doc: IImportHistoryInput,
    user: IUserDocument
  ): Promise<IImportHistoryDocument>;
  removeHistory(_id: string): Promise<string>;
}

class ImportHistory {
  /* 
   * Create new history
   */
  public static async createHistory(
    doc: IImportHistoryInput,
    user: IUserDocument
  ) {
    return ImportHistories.create({
      userId: user._id,
      date: new Date(),
      ...doc
    });
  }

  /*
   * Remove Imported history
   */
  public static async removeHistory(_id) {
    const historyObj = await ImportHistories.findOne({ _id });

    const { ids = [], contentType } = historyObj;

    let removeMethod = Customers.removeCustomer;

    if (contentType === "company") {
      removeMethod = Companies.removeCompany;
    }

    for (const id of ids) {
      await removeMethod(id);
    }

    await ImportHistories.remove({ _id });

    return _id;
  }
}

importHistorySchema.loadClass(ImportHistory);

const ImportHistories = model<IImportHistoryDocument, IImportHistoryModel>(
  "import_history",
  importHistorySchema
);

export default ImportHistories;
