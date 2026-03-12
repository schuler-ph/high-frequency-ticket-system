-- Custom SQL migration file, put your code below! --
CREATE OR REPLACE FUNCTION buy_ticket(
  p_event_id uuid,
  p_first_name text,
  p_last_name text
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_ticket_id uuid;
BEGIN
  UPDATE events
  SET sold_count = sold_count + 1
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found', p_event_id;
  END IF;

  INSERT INTO tickets (event_id, first_name, last_name)
  VALUES (p_event_id, p_first_name, p_last_name)
  RETURNING id INTO v_ticket_id;

  RETURN v_ticket_id;
END;
$$;