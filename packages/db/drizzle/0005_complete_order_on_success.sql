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
		VALUES (p_order_id, p_event_id, 'pending')
		ON CONFLICT (id) DO NOTHING;
	EXCEPTION
		WHEN foreign_key_violation THEN
			RAISE EXCEPTION 'Event % not found', p_event_id USING ERRCODE = 'P0001';
	END;

	IF NOT FOUND THEN
		RETURN NULL;
	END IF;

	UPDATE events
	SET sold_count = sold_count + 1
	WHERE id = p_event_id;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Event % not found', p_event_id USING ERRCODE = 'P0001';
	END IF;

	INSERT INTO tickets (event_id, order_id, first_name, last_name)
	VALUES (p_event_id, p_order_id, p_first_name, p_last_name)
	RETURNING id INTO v_ticket_id;

	UPDATE orders
	SET status = 'completed', updated_at = NOW()
	WHERE id = p_order_id;

	RETURN v_ticket_id;
END;
$$;