import mongoose from 'mongoose';
import { Note } from '../models/Note';
import { blocksToDoc, docToPlainText, extractLinks } from '../shared/notes/docUtils';

export async function migrateAllNotesToDoc(): Promise<{ converted: number; total: number }> {
  const query = {
    $or: [{ doc: null }, { doc: { $exists: false } }],
  };

  const notesToMigrate = await Note.find(query);
  let converted = 0;

  for (const note of notesToMigrate) {
    try {
      const doc = Array.isArray(note.blocks) && note.blocks.length > 0
        ? blocksToDoc(note.blocks)
        : { type: 'doc', content: [{ type: 'paragraph' }] };

      const plainText = docToPlainText(doc);
      const { noteIds, mediaIds } = extractLinks(doc);

      note.doc = doc;
      note.plainText = plainText;
      note.linkedNoteIds = noteIds;
      note.mediaIds = mediaIds;
      if (!note.kind) note.kind = 'page';
      if (typeof note.sortOrder !== 'number') note.sortOrder = 0;
      if (typeof note.isFavorite !== 'boolean') note.isFavorite = false;

      await note.save();
      converted++;
    } catch (err) {
      console.error(`[migration] Failed to migrate note ${note._id}:`, err);
    }
  }

  return { converted, total: notesToMigrate.length };
}

if (require.main === module) {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/lumen';
  mongoose.connect(mongoUri)
    .then(async () => {
      console.log('[migration] Connected to Mongo. Starting notes migration to ProseMirror doc...');
      const res = await migrateAllNotesToDoc();
      console.log(`[migration] Done. Converted ${res.converted}/${res.total} notes.`);
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migration] Fatal migration error:', err);
      process.exit(1);
    });
}

