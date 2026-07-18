-- Stage 2 / Backlog #7: buy_ticket ohne sold_count-Hot-Row-UPDATE.
--
-- Vorher (0008) hielt das sold_count-Increment-UPDATE auf `events` den
-- Row-Lock der einen `events`-Row fuer die gesamte Transaktion — alle parallelen
-- Worker-Transaktionen serialisierten darauf (Micro-Bench: 49/50 Pool-Backends
-- im Lock-Wait, ~235 tickets/s; siehe docs/reports/hot-row-bench/README.md).
--
-- Jetzt:
--   * Die Order wird DIREKT als 'completed' eingefuegt (kein Folge-UPDATE mehr).
--   * KEIN sold_count-UPDATE. Der Verkaufsstand wird ausschliesslich im
--     Reconcile-Loop aggregiert (COUNT(tickets) je Event) und dort als Snapshot
--     nach events.sold_count zurueckgeschrieben (ADR-011-Update).
--   * Oversell-Schutz liegt unveraendert in Redis (atomarer DECR + opensAt-Gate);
--     sold_count war nie die Schutzgrenze, nur die Reconcile-Eingabe.
--   * Event-Existenz wird weiterhin erzwungen — durch den Foreign Key der
--     orders.event_id (foreign_key_violation -> P0001), nicht mehr durch das
--     entfallene UPDATE.
--   * Idempotenz fuer doppelte orderId bleibt: ON CONFLICT DO NOTHING, dann
--     Rueckgabe des bereits existierenden Tickets.
CREATE OR REPLACE FUNCTION buy_ticket(
	p_event_id uuid,
	p_order_id uuid,
	p_first_name text,
	p_last_name text
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
	v_ticket_id uuid;
BEGIN
	BEGIN
		INSERT INTO orders (id, event_id, status)
		VALUES (p_order_id, p_event_id, 'completed')
		ON CONFLICT (id) DO NOTHING;
	EXCEPTION
		WHEN foreign_key_violation THEN
			RAISE EXCEPTION 'Event % not found', p_event_id USING ERRCODE = 'P0001';
	END;

	IF NOT FOUND THEN
		SELECT id
		INTO v_ticket_id
		FROM tickets
		WHERE order_id = p_order_id;

		RETURN v_ticket_id;
	END IF;

	INSERT INTO tickets (event_id, order_id, first_name, last_name)
	VALUES (p_event_id, p_order_id, p_first_name, p_last_name)
	RETURNING id INTO v_ticket_id;

	RETURN v_ticket_id;
END;
$$;
