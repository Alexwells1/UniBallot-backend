import { Router, Request, Response } from 'express';
import { parseSNSBody, handleSNSMessage } from '../controllers/emails/sns.controller';

const router = Router();

router.post('/ses', async (req: Request, res: Response) => {
  try {
    const snsMessage = parseSNSBody(req.body);
    const result = await handleSNSMessage(snsMessage);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[SNS webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;